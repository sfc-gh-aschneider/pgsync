import _snowflake
import pg8000
import ssl
import json
import time
from datetime import datetime, date


def run(session, config_id):
    start = time.time()
    cfg = None
    direction = "SF_TO_PG"
    history_id = None

    try:
        config = session.sql(
            f"SELECT c.*, i.PG_HOST, i.PG_PORT, i.PG_DATABASE, i.PG_SERVICE_USER, i.INSTANCE_NAME "
            f"FROM PGSYNC_DB.METADATA.SYNC_CONFIG_DATA c "
            f"JOIN PGSYNC_DB.METADATA.SYNC_INSTANCES i ON c.INSTANCE_ID = i.INSTANCE_ID "
            f"WHERE c.CONFIG_ID = {config_id} AND c.ENABLED = TRUE AND i.ENABLED = TRUE"
        ).collect()

        if not config:
            return {"status": "FAILED", "error": "Config not found or disabled"}

        cfg = config[0]
        direction = cfg["DIRECTION"]
        sync_mode = cfg["SYNC_MODE"]
        incremental_key = cfg["INCREMENTAL_KEY"]
        last_sync_value = cfg["LAST_SYNC_VALUE"]
        pg_host = cfg["PG_HOST"]
        pg_port = cfg["PG_PORT"]
        pg_database = cfg["PG_DATABASE"]

        # Write IN_PROGRESS record immediately so UI can show running state
        source_obj = ""
        target_obj = ""
        if direction == "SF_TO_PG":
            source_obj = f"{cfg['SOURCE_DATABASE']}.{cfg['SOURCE_SCHEMA']}.{cfg['SOURCE_OBJECT']}"
            target_obj = f"{cfg['TARGET_SCHEMA']}.{cfg['TARGET_TABLE']}"
        else:
            source_obj = f"{cfg['SOURCE_SCHEMA']}.{cfg['SOURCE_OBJECT']}"
            target_obj = f"{cfg['TARGET_DATABASE'] or ''}.{cfg['TARGET_SCHEMA']}.{cfg['TARGET_TABLE']}"

        src_esc = source_obj.replace("'", "''")
        tgt_esc = target_obj.replace("'", "''")
        session.sql(
            f"INSERT INTO PGSYNC_DB.METADATA.SYNC_HISTORY "
            f"(INSTANCE_ID, SYNC_TYPE, DIRECTION, STATUS, SOURCE_OBJECT, TARGET_OBJECT) "
            f"VALUES ({cfg['INSTANCE_ID']}, 'DATA_SYNC', '{direction}', 'IN_PROGRESS', "
            f"'{src_esc}', '{tgt_esc}')"
        ).collect()
        hid_row = session.sql(
            f"SELECT MAX(HISTORY_ID) AS HID FROM PGSYNC_DB.METADATA.SYNC_HISTORY "
            f"WHERE STATUS = 'IN_PROGRESS' AND SOURCE_OBJECT = '{src_esc}'"
        ).collect()
        if hid_row:
            history_id = hid_row[0]["HID"]

        SF_TO_PG_TYPE = {
            "NUMBER": "NUMERIC", "FLOAT": "DOUBLE PRECISION",
            "VARCHAR": "TEXT", "TEXT": "TEXT", "STRING": "TEXT", "CHAR": "TEXT",
            "BINARY": "BYTEA", "BOOLEAN": "BOOLEAN", "DATE": "DATE", "TIME": "TIME",
            "TIMESTAMP_NTZ": "TIMESTAMP", "TIMESTAMP_LTZ": "TIMESTAMPTZ",
            "TIMESTAMP_TZ": "TIMESTAMPTZ", "VARIANT": "JSONB", "OBJECT": "JSONB",
            "ARRAY": "JSONB", "GEOGRAPHY": "TEXT", "GEOMETRY": "TEXT",
        }

        PG_TO_SF_TYPE = {
            "integer": "NUMBER(38,0)", "bigint": "NUMBER(38,0)", "smallint": "NUMBER(38,0)",
            "numeric": "NUMBER(38,10)", "real": "FLOAT", "double precision": "FLOAT",
            "text": "VARCHAR", "character varying": "VARCHAR", "character": "VARCHAR",
            "boolean": "BOOLEAN", "date": "DATE", "time without time zone": "TIME",
            "timestamp without time zone": "TIMESTAMP_NTZ",
            "timestamp with time zone": "TIMESTAMP_TZ",
            "jsonb": "VARIANT", "json": "VARIANT", "bytea": "BINARY", "uuid": "VARCHAR",
        }

        def sf_type_to_pg(sf_type_str):
            t = sf_type_str.upper().strip()
            if t.startswith("NUMBER"):
                if "," in t:
                    parts = t.replace("NUMBER(", "").replace(")", "").split(",")
                    scale = int(parts[1].strip())
                    if scale == 0:
                        prec = int(parts[0].strip())
                        return "BIGINT" if prec > 9 else "INTEGER"
                    return "NUMERIC"
                return "BIGINT"
            if t.startswith("VARCHAR"):
                return "TEXT"
            if t.startswith("TIMESTAMP_NTZ"):
                return "TIMESTAMP"
            if t.startswith("TIMESTAMP_LTZ") or t.startswith("TIMESTAMP_TZ"):
                return "TIMESTAMPTZ"
            base = t.split("(")[0]
            return SF_TO_PG_TYPE.get(base, "TEXT")

        def get_pg_conn():
            secret_label = f"pg_secret_{cfg['INSTANCE_ID']}"
            try:
                secret = _snowflake.get_username_password(secret_label)
            except Exception:
                # Fallback to default secret if instance-specific not bound
                secret = _snowflake.get_username_password("pg_secret")
            ssl_context = ssl.create_default_context()
            ssl_context.check_hostname = False
            ssl_context.verify_mode = ssl.CERT_NONE
            import socket
            try:
                conn = pg8000.connect(
                    host=pg_host, port=pg_port, database=pg_database,
                    user=secret.username, password=secret.password,
                    ssl_context=ssl_context, timeout=30
                )
            except (OSError, socket.timeout) as e:
                raise RuntimeError(
                    f"Cannot connect to Postgres at {pg_host}:{pg_port}. "
                    f"Check: 1) Instance has a POSTGRES_INGRESS network policy attached, "
                    f"2) Network rule in EAI allows egress to this host, "
                    f"3) Instance is in READY state. Original error: {e}"
                ) from e
            conn.autocommit = True
            return conn

        def clean_value(val):
            if val is None:
                return None
            if isinstance(val, (datetime, date)):
                return str(val)
            return val

        if direction == "SF_TO_PG":
            source_fqn = f"{cfg['SOURCE_DATABASE']}.{cfg['SOURCE_SCHEMA']}.{cfg['SOURCE_OBJECT']}"
            target_tbl = f"{cfg['TARGET_SCHEMA']}.{cfg['TARGET_TABLE']}"

            schema_df = session.sql(f"DESCRIBE TABLE {source_fqn}").collect()
            columns = []
            pg_col_defs = []
            for col in schema_df:
                col_name = col["name"]
                sf_type = col["type"]
                pg_type = sf_type_to_pg(sf_type)
                columns.append(col_name)
                pg_col_defs.append(f'"{col_name.lower()}" {pg_type}')

            col_list = ", ".join([f'"{c}"' for c in columns])
            if sync_mode == "INCREMENTAL" and incremental_key and last_sync_value:
                source_sql = f'SELECT {col_list} FROM {source_fqn} WHERE "{incremental_key}" > \'{last_sync_value}\''
            else:
                source_sql = f"SELECT {col_list} FROM {source_fqn}"

            source_rows = session.sql(source_sql).collect()
            source_count = len(source_rows)

            pg_conn = get_pg_conn()
            cursor = pg_conn.cursor()

            schema_name = cfg["TARGET_SCHEMA"]
            # Try to create schema - will fail if user lacks CREATE on database
            # That's OK if schema already exists
            try:
                cursor.execute(f"CREATE SCHEMA IF NOT EXISTS {schema_name}")
            except Exception:
                pass  # Schema likely already exists

            tgt_table_lower = cfg["TARGET_TABLE"].lower()
            cursor.execute(
                f"SELECT EXISTS (SELECT 1 FROM information_schema.tables "
                f"WHERE table_schema = '{schema_name}' AND table_name = '{tgt_table_lower}')"
            )
            table_exists = cursor.fetchone()[0]

            if sync_mode == "FULL" or not table_exists:
                if table_exists:
                    # FULL mode: drop and recreate to handle schema drift
                    cursor.execute(f"DROP TABLE {target_tbl}")
                col_defs_str = ", ".join(pg_col_defs)
                cursor.execute(f"CREATE TABLE {target_tbl} ({col_defs_str})")
            else:
                # INCREMENTAL mode: detect and handle schema drift
                cursor.execute(
                    f"SELECT column_name FROM information_schema.columns "
                    f"WHERE table_schema = '{schema_name}' AND table_name = '{tgt_table_lower}' "
                    f"ORDER BY ordinal_position"
                )
                existing_cols = set(r[0] for r in cursor.fetchall())
                source_cols_lower = set(c.lower() for c in columns)
                new_cols = source_cols_lower - existing_cols
                if new_cols:
                    # Add missing columns to PG table
                    for pg_def in pg_col_defs:
                        col_name_quoted = pg_def.split(" ")[0].strip('"')
                        if col_name_quoted in new_cols:
                            try:
                                cursor.execute(f"ALTER TABLE {target_tbl} ADD COLUMN {pg_def}")
                            except Exception:
                                pass  # Column might already exist with different case

            rows_inserted = 0
            if source_count > 0:
                batch_size = 500
                col_names_lower = ", ".join([f'"{c.lower()}"' for c in columns])

                for i in range(0, source_count, batch_size):
                    batch = source_rows[i:i + batch_size]
                    placeholders_list = []
                    params = []
                    for row in batch:
                        ph = ", ".join(["%s"] * len(columns))
                        placeholders_list.append(f"({ph})")
                        for col in columns:
                            params.append(clean_value(row[col]))

                    sql = f"INSERT INTO {target_tbl} ({col_names_lower}) VALUES " + ", ".join(placeholders_list)
                    cursor.execute(sql, params)
                    rows_inserted += len(batch)

            if sync_mode == "INCREMENTAL" and incremental_key and source_count > 0:
                max_val = session.sql(f'SELECT MAX("{incremental_key}") FROM {source_fqn}').collect()[0][0]
                if max_val is not None:
                    escaped_val = str(max_val).replace("'", "''")
                    session.sql(
                        f"UPDATE PGSYNC_DB.METADATA.SYNC_CONFIG_DATA "
                        f"SET LAST_SYNC_VALUE = '{escaped_val}', UPDATED_AT = CURRENT_TIMESTAMP() "
                        f"WHERE CONFIG_ID = {config_id}"
                    ).collect()

            cursor.execute(f"SELECT count(*) FROM {target_tbl}")
            target_count = cursor.fetchone()[0]
            pg_conn.close()

            duration = round(time.time() - start, 1)
            if history_id:
                session.sql(
                    f"UPDATE PGSYNC_DB.METADATA.SYNC_HISTORY SET STATUS = 'SUCCESS', "
                    f"ROW_COUNT_SOURCE = {source_count}, ROW_COUNT_TARGET = {target_count}, "
                    f"ROWS_INSERTED = {rows_inserted}, DURATION_SECONDS = {duration} "
                    f"WHERE HISTORY_ID = {history_id}"
                ).collect()
            else:
                session.sql(
                    f"INSERT INTO PGSYNC_DB.METADATA.SYNC_HISTORY "
                    f"(INSTANCE_ID, SYNC_TYPE, DIRECTION, STATUS, SOURCE_OBJECT, TARGET_OBJECT, "
                    f"ROW_COUNT_SOURCE, ROW_COUNT_TARGET, ROWS_INSERTED, DURATION_SECONDS) "
                    f"VALUES ({cfg['INSTANCE_ID']}, 'DATA_SYNC', 'SF_TO_PG', 'SUCCESS', "
                    f"'{source_fqn}', '{target_tbl}', {source_count}, {target_count}, "
                    f"{rows_inserted}, {duration})"
                ).collect()

            return {
                "status": "SUCCESS", "direction": "SF_TO_PG", "source": source_fqn,
                "target": target_tbl, "rows_synced": rows_inserted,
                "target_total": target_count, "duration_seconds": duration, "mode": sync_mode
            }

        else:
            # PG_TO_SF
            source_tbl = f"{cfg['SOURCE_SCHEMA']}.{cfg['SOURCE_OBJECT']}"
            target_fqn = f"{cfg['TARGET_DATABASE']}.{cfg['TARGET_SCHEMA']}.{cfg['TARGET_TABLE']}"

            pg_conn = get_pg_conn()
            cursor = pg_conn.cursor()

            src_schema = cfg["SOURCE_SCHEMA"].lower()
            src_obj = cfg["SOURCE_OBJECT"].lower()
            cursor.execute(
                f"SELECT column_name, data_type FROM information_schema.columns "
                f"WHERE table_schema = '{src_schema}' AND table_name = '{src_obj}' "
                f"ORDER BY ordinal_position"
            )
            pg_columns = cursor.fetchall()

            if not pg_columns:
                pg_conn.close()
                err_msg = f"Source table {source_tbl} not found in Postgres"
                if history_id:
                    session.sql(
                        f"UPDATE PGSYNC_DB.METADATA.SYNC_HISTORY SET STATUS = 'FAILED', "
                        f"ERROR_MESSAGE = '{err_msg}', DURATION_SECONDS = {round(time.time() - start, 1)} "
                        f"WHERE HISTORY_ID = {history_id}"
                    ).collect()
                return {"status": "FAILED", "error": err_msg}

            columns = [c[0] for c in pg_columns]
            sf_col_defs = []
            for col_name, pg_type in pg_columns:
                sf_type = PG_TO_SF_TYPE.get(pg_type, "VARCHAR")
                sf_col_defs.append(f'"{col_name.upper()}" {sf_type}')

            col_list = ", ".join([f'"{c}"' for c in columns])
            if sync_mode == "INCREMENTAL" and incremental_key and last_sync_value:
                cursor.execute(f'SELECT {col_list} FROM {source_tbl} WHERE "{incremental_key}" > %s', [last_sync_value])
            else:
                cursor.execute(f"SELECT {col_list} FROM {source_tbl}")

            rows = cursor.fetchall()
            source_count = len(rows)
            pg_conn.close()

            target_db = cfg["TARGET_DATABASE"]
            target_schema = cfg["TARGET_SCHEMA"]
            session.sql(f"CREATE DATABASE IF NOT EXISTS {target_db}").collect()
            session.sql(f"CREATE SCHEMA IF NOT EXISTS {target_db}.{target_schema}").collect()
            col_defs_str = ", ".join(sf_col_defs)
            session.sql(f"CREATE TABLE IF NOT EXISTS {target_fqn} ({col_defs_str})").collect()

            if sync_mode == "FULL":
                session.sql(f"TRUNCATE TABLE {target_fqn}").collect()

            rows_inserted = 0
            if source_count > 0:
                batch_size = 500
                sf_col_names = ", ".join([f'"{c.upper()}"' for c in columns])

                for i in range(0, source_count, batch_size):
                    batch = rows[i:i + batch_size]
                    values_list = []
                    for row in batch:
                        vals = []
                        for v in row:
                            if v is None:
                                vals.append("NULL")
                            elif isinstance(v, bool):
                                vals.append("TRUE" if v else "FALSE")
                            elif isinstance(v, (int, float)):
                                vals.append(str(v))
                            elif isinstance(v, datetime):
                                if v.tzinfo is not None:
                                    vals.append(f"'{v.strftime('%Y-%m-%d %H:%M:%S.%f %z')}'::TIMESTAMP_TZ")
                                else:
                                    vals.append(f"'{v.strftime('%Y-%m-%d %H:%M:%S.%f')}'")
                            elif isinstance(v, date):
                                vals.append(f"'{v.isoformat()}'")
                            else:
                                escaped = str(v).replace("'", "''")
                                vals.append(f"'{escaped}'")
                        values_list.append(f"({', '.join(vals)})")

                    insert_sql = f"INSERT INTO {target_fqn} ({sf_col_names}) VALUES {', '.join(values_list)}"
                    session.sql(insert_sql).collect()
                    rows_inserted += len(batch)

            target_count_row = session.sql(f"SELECT COUNT(*) FROM {target_fqn}").collect()
            target_count = target_count_row[0][0]

            duration = round(time.time() - start, 1)
            if history_id:
                session.sql(
                    f"UPDATE PGSYNC_DB.METADATA.SYNC_HISTORY SET STATUS = 'SUCCESS', "
                    f"ROW_COUNT_SOURCE = {source_count}, ROW_COUNT_TARGET = {target_count}, "
                    f"ROWS_INSERTED = {rows_inserted}, DURATION_SECONDS = {duration} "
                    f"WHERE HISTORY_ID = {history_id}"
                ).collect()
            else:
                session.sql(
                    f"INSERT INTO PGSYNC_DB.METADATA.SYNC_HISTORY "
                    f"(INSTANCE_ID, SYNC_TYPE, DIRECTION, STATUS, SOURCE_OBJECT, TARGET_OBJECT, "
                    f"ROW_COUNT_SOURCE, ROW_COUNT_TARGET, ROWS_INSERTED, DURATION_SECONDS) "
                    f"VALUES ({cfg['INSTANCE_ID']}, 'DATA_SYNC', 'PG_TO_SF', 'SUCCESS', "
                    f"'{source_tbl}', '{target_fqn}', {source_count}, {target_count}, "
                    f"{rows_inserted}, {duration})"
                ).collect()

            return {
                "status": "SUCCESS", "direction": "PG_TO_SF", "source": source_tbl,
                "target": target_fqn, "rows_synced": rows_inserted,
                "target_total": target_count, "duration_seconds": duration, "mode": sync_mode
            }

    except Exception as e:
        duration = round(time.time() - start, 1)
        error_msg = str(e)[:1000].replace("'", "''")
        source_obj = ""
        target_obj = ""
        try:
            inst_id = cfg["INSTANCE_ID"] if cfg else "NULL"
            if cfg and direction == "SF_TO_PG":
                source_obj = f"{cfg['SOURCE_DATABASE'] or ''}.{cfg['SOURCE_SCHEMA'] or ''}.{cfg['SOURCE_OBJECT'] or ''}"
                target_obj = f"{cfg['TARGET_SCHEMA'] or ''}.{cfg['TARGET_TABLE'] or ''}"
            elif cfg:
                source_obj = f"{cfg['SOURCE_SCHEMA'] or ''}.{cfg['SOURCE_OBJECT'] or ''}"
                target_obj = f"{cfg['TARGET_DATABASE'] or ''}.{cfg['TARGET_SCHEMA'] or ''}.{cfg['TARGET_TABLE'] or ''}"
            src_esc = source_obj.replace("'", "''")
            tgt_esc = target_obj.replace("'", "''")
            if history_id:
                session.sql(
                    f"UPDATE PGSYNC_DB.METADATA.SYNC_HISTORY SET STATUS = 'FAILED', "
                    f"DURATION_SECONDS = {duration}, ERROR_MESSAGE = '{error_msg}' "
                    f"WHERE HISTORY_ID = {history_id}"
                ).collect()
            else:
                session.sql(
                    f"INSERT INTO PGSYNC_DB.METADATA.SYNC_HISTORY "
                    f"(INSTANCE_ID, SYNC_TYPE, DIRECTION, STATUS, SOURCE_OBJECT, TARGET_OBJECT, "
                    f"DURATION_SECONDS, ERROR_MESSAGE) "
                    f"VALUES ({inst_id}, 'DATA_SYNC', '{direction}', 'FAILED', "
                    f"'{src_esc}', '{tgt_esc}', {duration}, '{error_msg}')"
                ).collect()
        except:
            pass
        return {
            "status": "FAILED",
            "error": str(e)[:1000],
            "direction": direction,
            "source": source_obj,
            "target": target_obj,
            "duration_seconds": duration
        }
