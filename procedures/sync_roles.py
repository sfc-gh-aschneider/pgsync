import _snowflake
import pg8000
import ssl
import json
import time


def run(session, instance_id):
    start = time.time()

    inst = session.sql(
        f"SELECT * FROM PGSYNC_DB.METADATA.SYNC_INSTANCES WHERE INSTANCE_ID = {instance_id}"
    ).collect()
    if not inst:
        return {"status": "FAILED", "error": "Instance not found"}
    inst = inst[0]

    roles = session.sql(
        f"SELECT * FROM PGSYNC_DB.METADATA.SYNC_CONFIG_ROLES "
        f"WHERE INSTANCE_ID = {instance_id} AND ENABLED = TRUE"
    ).collect()

    if not roles:
        return {"status": "SUCCESS", "message": "No roles configured for sync"}

    # Get active SF_TO_PG data sync mappings for this instance
    synced = session.sql(
        f"SELECT SOURCE_DATABASE, SOURCE_SCHEMA, SOURCE_OBJECT, TARGET_SCHEMA, TARGET_TABLE "
        f"FROM PGSYNC_DB.METADATA.SYNC_CONFIG_DATA "
        f"WHERE INSTANCE_ID = {instance_id} AND DIRECTION = 'SF_TO_PG' AND ENABLED = TRUE"
    ).collect()

    # Build mapping: "DB.SCHEMA.OBJECT" (uppercase) -> "target_schema.target_table" (lowercase PG)
    sf_to_pg_map = {}
    for s in synced:
        sf_key = f"{s['SOURCE_DATABASE']}.{s['SOURCE_SCHEMA']}.{s['SOURCE_OBJECT']}".upper()
        sf_to_pg_map[sf_key] = f"{s['TARGET_SCHEMA']}.{s['TARGET_TABLE']}"

    # Also build schema mapping from synced objects
    synced_schemas = set()
    for s in synced:
        synced_schemas.add(s['TARGET_SCHEMA'].lower())

    # Connect to PG
    secret_label = f"pg_secret_{inst['INSTANCE_ID']}"
    try:
        secret = _snowflake.get_username_password(secret_label)
    except Exception:
        secret = _snowflake.get_username_password("pg_secret")
    ssl_context = ssl.create_default_context()
    ssl_context.check_hostname = False
    ssl_context.verify_mode = ssl.CERT_NONE
    import socket
    try:
        pg_conn = pg8000.connect(
            host=inst["PG_HOST"], port=inst["PG_PORT"], database=inst["PG_DATABASE"],
            user=secret.username, password=secret.password,
            ssl_context=ssl_context, timeout=30
        )
    except (OSError, socket.timeout) as e:
        return {
            "status": "FAILED",
            "error": f"Cannot connect to Postgres at {inst['PG_HOST']}:{inst['PG_PORT']}. "
                     f"Check: 1) Instance has a POSTGRES_INGRESS network policy, "
                     f"2) EAI network rule allows egress to this host, "
                     f"3) Instance is READY. Error: {e}"
        }
    pg_conn.autocommit = True
    cursor = pg_conn.cursor()

    PRIV_MAP = {
        "SELECT": "SELECT", "INSERT": "INSERT", "UPDATE": "UPDATE",
        "DELETE": "DELETE", "TRUNCATE": "TRUNCATE", "REFERENCES": "REFERENCES",
        "USAGE": "USAGE",
    }

    results = []

    for role_cfg in roles:
        sf_role = role_cfg["SNOWFLAKE_ROLE"]
        pg_role = role_cfg["PG_ROLE"]
        sync_grants = role_cfg["SYNC_GRANTS"]

        try:
            # Create role if not exists
            cursor.execute(
                f"DO $$ BEGIN "
                f"IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '{pg_role}') THEN "
                f"CREATE ROLE {pg_role}; "
                f"END IF; END $$"
            )
            results.append({"action": "CREATE_ROLE", "role": pg_role, "status": "OK"})

            if sync_grants:
                sf_grants = session.sql(f"SHOW GRANTS TO ROLE {sf_role}").collect()
                grants_applied = 0
                grants_skipped = 0
                skipped_details = []

                for g in sf_grants:
                    priv = g["privilege"]
                    granted_on = g["granted_on"]
                    obj_name = g["name"]

                    pg_priv = PRIV_MAP.get(priv)
                    if not pg_priv:
                        grants_skipped += 1
                        skipped_details.append({
                            "object": obj_name, "privilege": priv,
                            "reason": f"Privilege '{priv}' has no PG equivalent"
                        })
                        continue

                    if granted_on == "SCHEMA":
                        # Check if this schema is a target schema in any active sync
                        schema_name = obj_name.split(".")[-1].lower() if "." in obj_name else obj_name.lower()
                        if schema_name in synced_schemas:
                            try:
                                cursor.execute(f"GRANT {pg_priv} ON SCHEMA {schema_name} TO {pg_role}")
                                grants_applied += 1
                            except Exception as ge:
                                grants_skipped += 1
                                skipped_details.append({
                                    "object": obj_name, "privilege": priv,
                                    "reason": f"GRANT on schema failed: {str(ge)[:100]}"
                                })
                        else:
                            grants_skipped += 1
                            skipped_details.append({
                                "object": obj_name, "privilege": priv,
                                "reason": "No active data sync targets this schema"
                            })

                    elif granted_on in ("TABLE", "VIEW", "DYNAMIC_TABLE"):
                        # Look up the SF object in our sync mapping
                        sf_fqn = obj_name.upper()
                        pg_target = sf_to_pg_map.get(sf_fqn)

                        if pg_target:
                            try:
                                cursor.execute(f"GRANT {pg_priv} ON TABLE {pg_target} TO {pg_role}")
                                grants_applied += 1
                            except Exception as ge:
                                grants_skipped += 1
                                skipped_details.append({
                                    "object": obj_name, "privilege": priv,
                                    "pg_target": pg_target,
                                    "reason": f"GRANT failed: {str(ge)[:100]}"
                                })
                        else:
                            grants_skipped += 1
                            skipped_details.append({
                                "object": obj_name, "privilege": priv,
                                "reason": "No active data sync for this object"
                            })
                    else:
                        grants_skipped += 1
                        skipped_details.append({
                            "object": obj_name, "privilege": priv, "type": granted_on,
                            "reason": f"Object type '{granted_on}' not syncable (only TABLE/VIEW/DYNAMIC_TABLE/SCHEMA)"
                        })

                grant_result = {
                    "action": "SYNC_GRANTS", "role": pg_role, "sf_role": sf_role,
                    "grants_applied": grants_applied, "grants_skipped": grants_skipped, "status": "OK"
                }
                if skipped_details:
                    grant_result["skipped_details"] = skipped_details[:20]
                results.append(grant_result)

        except Exception as e:
            results.append({"action": "ROLE_SYNC", "role": pg_role, "status": "FAILED", "error": str(e)[:200]})

    pg_conn.close()
    duration = round(time.time() - start, 1)

    failures = [r for r in results if r.get("status") == "FAILED"]
    status = "SUCCESS" if not failures else "PARTIAL"

    try:
        details_json = json.dumps(results)
        session.sql(
            f"INSERT INTO PGSYNC_DB.METADATA.SYNC_HISTORY "
            f"(INSTANCE_ID, SYNC_TYPE, STATUS, DURATION_SECONDS, DETAILS) "
            f"SELECT {instance_id}, 'ROLE_SYNC', '{status}', {duration}, "
            f"TRY_PARSE_JSON($${details_json}$$)"
        ).collect()
    except Exception:
        session.sql(
            f"INSERT INTO PGSYNC_DB.METADATA.SYNC_HISTORY "
            f"(INSTANCE_ID, SYNC_TYPE, STATUS, DURATION_SECONDS) "
            f"SELECT {instance_id}, 'ROLE_SYNC', '{status}', {duration}"
        ).collect()

    return {"status": status, "results": results, "duration_seconds": duration}
