import _snowflake
import pg8000
import ssl
import json
import time


def run(session, role_name, instance_id):
    inst = session.sql(
        f"SELECT * FROM PGSYNC_DB.METADATA.SYNC_INSTANCES WHERE INSTANCE_ID = {instance_id}"
    ).collect()
    if not inst:
        return {"status": "FAILED", "error": "Instance not found"}
    inst = inst[0]

    # Get grants for this role
    grants = session.sql(f"SHOW GRANTS TO ROLE {role_name}").collect()

    # Categorize grants
    schema_grants = []
    table_grants = []
    other_grants = []

    for g in grants:
        priv = g["privilege"]
        granted_on = g["granted_on"]
        name = g["name"]

        if granted_on == "DATABASE":
            other_grants.append({
                "type": "DATABASE", "privilege": priv, "object": name,
                "pg_applicable": False, "reason": "Database-level grants not applicable in PG"
            })
        elif granted_on == "SCHEMA":
            schema_grants.append({"type": "SCHEMA", "privilege": priv, "object": name})
        elif granted_on in ("TABLE", "VIEW"):
            table_grants.append({"type": granted_on, "privilege": priv, "object": name})
        else:
            other_grants.append({
                "type": granted_on, "privilege": priv, "object": name,
                "pg_applicable": False, "reason": f"{granted_on} grants not applicable in PG"
            })

    # Connect to PG and check what exists
    secret = _snowflake.get_username_password("pg_secret")
    ssl_context = ssl.create_default_context()
    ssl_context.check_hostname = False
    ssl_context.verify_mode = ssl.CERT_NONE
    pg_conn = pg8000.connect(
        host=inst["PG_HOST"], port=inst["PG_PORT"], database=inst["PG_DATABASE"],
        user=secret.username, password=secret.password, ssl_context=ssl_context
    )
    pg_conn.autocommit = True
    cursor = pg_conn.cursor()

    cursor.execute("SELECT schema_name FROM information_schema.schemata")
    pg_schemas = set(r[0] for r in cursor.fetchall())

    cursor.execute(
        "SELECT table_schema || '.' || table_name FROM information_schema.tables "
        "WHERE table_schema NOT IN ('pg_catalog', 'information_schema')"
    )
    pg_tables = set(r[0] for r in cursor.fetchall())
    pg_conn.close()

    PRIV_MAP = {
        "SELECT": "SELECT", "INSERT": "INSERT", "UPDATE": "UPDATE",
        "DELETE": "DELETE", "REFERENCES": "REFERENCES", "USAGE": "USAGE",
        "TRUNCATE": "TRUNCATE",
    }

    syncable_grants = []
    missing_objects = []
    not_applicable = []

    for sg in schema_grants:
        sf_schema = sg["object"].split(".")[-1].lower() if "." in sg["object"] else sg["object"].lower()
        pg_priv = PRIV_MAP.get(sg["privilege"])
        if not pg_priv:
            not_applicable.append({**sg, "reason": f"Privilege {sg['privilege']} has no PG equivalent"})
            continue
        if sf_schema in pg_schemas:
            syncable_grants.append({**sg, "pg_target": sf_schema, "pg_privilege": pg_priv, "exists_in_pg": True})
        else:
            missing_objects.append({**sg, "pg_target": sf_schema, "missing": "schema", "action_needed": "Create schema or sync data first"})

    for tg in table_grants:
        parts = tg["object"].split(".")
        if len(parts) >= 3:
            pg_target = f"{parts[-2].lower()}.{parts[-1].lower()}"
        elif len(parts) == 2:
            pg_target = f"{parts[0].lower()}.{parts[1].lower()}"
        else:
            pg_target = tg["object"].lower()

        pg_priv = PRIV_MAP.get(tg["privilege"])
        if not pg_priv:
            not_applicable.append({**tg, "reason": f"Privilege {tg['privilege']} has no PG equivalent"})
            continue

        if pg_target in pg_tables:
            syncable_grants.append({**tg, "pg_target": pg_target, "pg_privilege": pg_priv, "exists_in_pg": True})
        else:
            missing_objects.append({**tg, "pg_target": pg_target, "missing": "table", "action_needed": "Sync this table to PG first"})

    return {
        "status": "SUCCESS",
        "role": role_name,
        "summary": {
            "total_grants": len(grants),
            "syncable": len(syncable_grants),
            "missing_objects": len(missing_objects),
            "not_applicable": len(not_applicable) + len(other_grants)
        },
        "syncable_grants": syncable_grants,
        "missing_objects": missing_objects,
        "not_applicable": not_applicable + other_grants
    }
