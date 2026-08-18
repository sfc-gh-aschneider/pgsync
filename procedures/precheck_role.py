import _snowflake
import json


def run(session, role_name, instance_id):
    inst = session.sql(
        f"SELECT * FROM PGSYNC_DB.METADATA.SYNC_INSTANCES WHERE INSTANCE_ID = {instance_id}"
    ).collect()
    if not inst:
        return {"status": "FAILED", "error": "Instance not found"}

    # Get grants for this role
    grants = session.sql(f"SHOW GRANTS TO ROLE {role_name}").collect()

    # Get active SF_TO_PG data sync mappings for this instance
    synced = session.sql(
        f"SELECT SOURCE_DATABASE, SOURCE_SCHEMA, SOURCE_OBJECT, TARGET_SCHEMA, TARGET_TABLE "
        f"FROM PGSYNC_DB.METADATA.SYNC_CONFIG_DATA "
        f"WHERE INSTANCE_ID = {instance_id} AND DIRECTION = 'SF_TO_PG' AND ENABLED = TRUE"
    ).collect()

    # Build mapping: "DB.SCHEMA.OBJECT" (uppercase) -> "target_schema.target_table"
    sf_to_pg_map = {}
    for s in synced:
        sf_key = f"{s['SOURCE_DATABASE']}.{s['SOURCE_SCHEMA']}.{s['SOURCE_OBJECT']}".upper()
        sf_to_pg_map[sf_key] = f"{s['TARGET_SCHEMA']}.{s['TARGET_TABLE']}"

    synced_schemas = set()
    for s in synced:
        synced_schemas.add(s['TARGET_SCHEMA'].lower())

    PRIV_MAP = {
        "SELECT": "SELECT", "INSERT": "INSERT", "UPDATE": "UPDATE",
        "DELETE": "DELETE", "REFERENCES": "REFERENCES", "USAGE": "USAGE",
        "TRUNCATE": "TRUNCATE",
    }

    syncable_grants = []
    no_data_sync = []
    not_applicable = []

    for g in grants:
        priv = g["privilege"]
        granted_on = g["granted_on"]
        name = g["name"]

        pg_priv = PRIV_MAP.get(priv)

        if granted_on == "SCHEMA":
            if not pg_priv:
                not_applicable.append({"type": "SCHEMA", "privilege": priv, "object": name, "reason": f"Privilege '{priv}' has no PG equivalent"})
                continue
            schema_name = name.split(".")[-1].lower() if "." in name else name.lower()
            if schema_name in synced_schemas:
                syncable_grants.append({"type": "SCHEMA", "privilege": priv, "object": name, "pg_target": schema_name, "pg_privilege": pg_priv})
            else:
                no_data_sync.append({"type": "SCHEMA", "privilege": priv, "object": name, "pg_target": schema_name, "reason": "No active data sync targets this schema"})

        elif granted_on in ("TABLE", "VIEW", "DYNAMIC_TABLE"):
            if not pg_priv:
                not_applicable.append({"type": granted_on, "privilege": priv, "object": name, "reason": f"Privilege '{priv}' has no PG equivalent"})
                continue
            sf_fqn = name.upper()
            pg_target = sf_to_pg_map.get(sf_fqn)
            if pg_target:
                syncable_grants.append({"type": granted_on, "privilege": priv, "object": name, "pg_target": pg_target, "pg_privilege": pg_priv})
            else:
                no_data_sync.append({"type": granted_on, "privilege": priv, "object": name, "reason": "No active data sync for this object"})

        else:
            not_applicable.append({
                "type": granted_on, "privilege": priv, "object": name,
                "reason": f"{granted_on} grants not applicable in PG"
            })

    return {
        "status": "SUCCESS",
        "role": role_name,
        "summary": {
            "total_grants": len(grants),
            "syncable": len(syncable_grants),
            "no_data_sync": len(no_data_sync),
            "not_applicable": len(not_applicable)
        },
        "syncable_grants": syncable_grants,
        "no_data_sync": no_data_sync,
        "not_applicable": not_applicable
    }
