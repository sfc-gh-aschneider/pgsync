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

    policies = session.sql(
        f"SELECT * FROM PGSYNC_DB.METADATA.SYNC_CONFIG_POLICIES "
        f"WHERE INSTANCE_ID = {instance_id} AND ENABLED = TRUE"
    ).collect()

    if not policies:
        return {"status": "SUCCESS", "message": "No policies configured"}

    # Connect to PG
    secret_label = f"pg_secret_{inst['INSTANCE_ID']}"
    try:
        secret = _snowflake.get_username_password(secret_label)
    except Exception:
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

    results = []

    for policy in policies:
        policy_id = policy["POLICY_ID"]
        policy_type = policy["POLICY_TYPE"]
        target_schema = policy["TARGET_SCHEMA"]
        target_table = policy["TARGET_TABLE"]
        policy_name = policy["POLICY_NAME"]
        definition = policy["POLICY_DEFINITION"]

        if isinstance(definition, str):
            definition = json.loads(definition)

        target_fqn = f"{target_schema}.{target_table}"

        try:
            if policy_type == "RLS":
                # Row-Level Security
                # Definition format: { "bypass_roles": ["medical_role"], "filter": "team_id = 'BULLDOGS'", "filter_role": "coaching_role" }
                bypass_roles = definition.get("bypass_roles", [])
                filter_expr = definition.get("filter", "TRUE")
                filter_role = definition.get("filter_role", "")

                # Enable RLS on the table
                cursor.execute(f"ALTER TABLE {target_fqn} ENABLE ROW LEVEL SECURITY")

                # Drop existing policy with same name if exists
                try:
                    cursor.execute(f"DROP POLICY IF EXISTS {policy_name} ON {target_fqn}")
                except Exception:
                    pass

                # Build USING clause
                using_parts = []
                for role in bypass_roles:
                    using_parts.append(f"pg_has_role(current_user, '{role}', 'MEMBER')")

                if filter_role and filter_expr:
                    using_parts.append(f"(pg_has_role(current_user, '{filter_role}', 'MEMBER') AND {filter_expr})")
                elif filter_expr and filter_expr != "TRUE":
                    using_parts.append(filter_expr)

                if not using_parts:
                    using_clause = "TRUE"
                else:
                    using_clause = " OR ".join(using_parts)

                # Create the policy
                cursor.execute(
                    f"CREATE POLICY {policy_name} ON {target_fqn} FOR SELECT USING ({using_clause})"
                )

                # Force RLS on table owner too (important for testing)
                cursor.execute(f"ALTER TABLE {target_fqn} FORCE ROW LEVEL SECURITY")

                results.append({
                    "policy_id": policy_id, "name": policy_name, "type": "RLS",
                    "table": target_fqn, "status": "APPLIED"
                })

                # Mark as applied
                session.sql(
                    f"UPDATE PGSYNC_DB.METADATA.SYNC_CONFIG_POLICIES "
                    f"SET APPLIED = TRUE, APPLIED_AT = CURRENT_TIMESTAMP() "
                    f"WHERE POLICY_ID = {policy_id}"
                ).collect()

            elif policy_type == "COLUMN":
                # Column restriction
                # Definition format: { "restricted_columns": ["salary", "medical_notes"], "restricted_from_roles": ["coaching_role"] }
                restricted_cols = definition.get("restricted_columns", [])
                restricted_roles = definition.get("restricted_from_roles", [])

                for role in restricted_roles:
                    for col in restricted_cols:
                        cursor.execute(
                            f"REVOKE SELECT ({col}) ON {target_fqn} FROM {role}"
                        )

                results.append({
                    "policy_id": policy_id, "name": policy_name, "type": "COLUMN",
                    "table": target_fqn, "status": "APPLIED",
                    "columns_restricted": len(restricted_cols), "roles": restricted_roles
                })

                session.sql(
                    f"UPDATE PGSYNC_DB.METADATA.SYNC_CONFIG_POLICIES "
                    f"SET APPLIED = TRUE, APPLIED_AT = CURRENT_TIMESTAMP() "
                    f"WHERE POLICY_ID = {policy_id}"
                ).collect()

        except Exception as e:
            results.append({
                "policy_id": policy_id, "name": policy_name, "type": policy_type,
                "table": target_fqn, "status": "FAILED", "error": str(e)[:200]
            })

    pg_conn.close()
    duration = round(time.time() - start, 1)

    failures = [r for r in results if r.get("status") == "FAILED"]
    status = "SUCCESS" if not failures else "PARTIAL"

    return {"status": status, "results": results, "duration_seconds": duration}
