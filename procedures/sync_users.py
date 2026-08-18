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

    users = session.sql(
        f"SELECT * FROM PGSYNC_DB.METADATA.SYNC_CONFIG_USERS "
        f"WHERE INSTANCE_ID = {instance_id} AND ENABLED = TRUE"
    ).collect()

    if not users:
        return {"status": "SUCCESS", "message": "No users configured for sync"}

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

    results = []

    for user_cfg in users:
        sf_user = user_cfg["SNOWFLAKE_USER"]
        pg_user = user_cfg["PG_USER"]
        auth_mode = user_cfg["AUTH_MODE"]
        pg_password = user_cfg["PG_PASSWORD"]
        user_roles = user_cfg["ROLES"]

        try:
            # Check if user exists
            cursor.execute(f"SELECT 1 FROM pg_roles WHERE rolname = '{pg_user}'")
            exists = cursor.fetchone()

            if not exists:
                if auth_mode in ("PASSWORD", "BOTH") and pg_password:
                    cursor.execute(f"CREATE USER {pg_user} WITH LOGIN PASSWORD '{pg_password}'")
                else:
                    cursor.execute(f"CREATE USER {pg_user} WITH LOGIN")
                results.append({"action": "CREATE_USER", "user": pg_user, "status": "OK"})
            else:
                if auth_mode in ("PASSWORD", "BOTH") and pg_password:
                    cursor.execute(f"ALTER USER {pg_user} WITH PASSWORD '{pg_password}'")
                results.append({"action": "UPDATE_USER", "user": pg_user, "status": "OK"})

            # Set snowflake.user mapping for token auth
            if auth_mode in ("TOKEN", "BOTH"):
                try:
                    cursor.execute(f'ALTER USER {pg_user} SET "snowflake.user" = \'{sf_user}\'')
                    results.append({"action": "SET_SF_USER", "user": pg_user, "sf_user": sf_user, "status": "OK"})
                except Exception as e:
                    err_str = str(e)
                    if "permission denied" in err_str.lower():
                        hint = ("Platform restriction: setting 'snowflake.user' requires elevated privileges. "
                                "The service account may need ADMIN OPTION on the target role, or this "
                                "attribute can only be set by the platform during Snowflake-delegated auth setup.")
                    else:
                        hint = err_str[:200]
                    results.append({"action": "SET_SF_USER", "user": pg_user, "status": "FAILED", "error": hint})

            # Assign roles
            if user_roles:
                role_list = user_roles if isinstance(user_roles, list) else json.loads(str(user_roles))
                for role in role_list:
                    try:
                        cursor.execute(f"GRANT {role} TO {pg_user}")
                        results.append({"action": "GRANT_ROLE", "role": role, "user": pg_user, "status": "OK"})
                    except Exception as e:
                        results.append({"action": "GRANT_ROLE", "role": role, "user": pg_user, "status": "FAILED", "error": str(e)[:200]})

        except Exception as e:
            results.append({"action": "USER_SYNC", "user": pg_user, "status": "FAILED", "error": str(e)[:200]})

    pg_conn.close()
    duration = round(time.time() - start, 1)

    failures = [r for r in results if r.get("status") == "FAILED"]
    status = "SUCCESS" if not failures else "PARTIAL"

    try:
        details_json = json.dumps(results)
        # Use bind-style approach via a temp table to avoid SQL injection/escaping issues
        session.sql(
            f"INSERT INTO PGSYNC_DB.METADATA.SYNC_HISTORY "
            f"(INSTANCE_ID, SYNC_TYPE, STATUS, DURATION_SECONDS, DETAILS) "
            f"SELECT {instance_id}, 'USER_SYNC', '{status}', {duration}, "
            f"TRY_PARSE_JSON($${details_json}$$)"
        ).collect()
    except Exception:
        # Fallback: log without details if JSON is problematic
        session.sql(
            f"INSERT INTO PGSYNC_DB.METADATA.SYNC_HISTORY "
            f"(INSTANCE_ID, SYNC_TYPE, STATUS, DURATION_SECONDS) "
            f"SELECT {instance_id}, 'USER_SYNC', '{status}', {duration}"
        ).collect()

    return {"status": status, "results": results, "duration_seconds": duration}
