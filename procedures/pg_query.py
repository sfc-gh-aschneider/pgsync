import _snowflake
import pg8000
import ssl
import json


def run(session, instance_id, sql_text):
    inst = session.sql(
        f"SELECT * FROM PGSYNC_DB.METADATA.SYNC_INSTANCES WHERE INSTANCE_ID = {instance_id}"
    ).collect()
    if not inst:
        return {"error": "Instance not found"}
    inst = inst[0]

    secret_label = f"pg_secret_{inst['INSTANCE_ID']}"
    try:
        secret = _snowflake.get_username_password(secret_label)
    except Exception:
        secret = _snowflake.get_username_password("pg_secret")
    ssl_context = ssl.create_default_context()
    ssl_context.check_hostname = False
    ssl_context.verify_mode = ssl.CERT_NONE

    try:
        conn = pg8000.connect(
            host=inst["PG_HOST"], port=inst["PG_PORT"], database=inst["PG_DATABASE"],
            user=secret.username, password=secret.password,
            ssl_context=ssl_context, timeout=30
        )
    except Exception as e:
        err_str = str(e)
        if "Can't create a connection" in err_str or "timed out" in err_str.lower():
            return {
                "status": "FAILED",
                "error": f"Cannot connect to Postgres at {inst['PG_HOST']}:{inst['PG_PORT']}. "
                         f"Check: 1) Instance has a POSTGRES_INGRESS network policy attached, "
                         f"2) EAI network rule allows egress to this host, "
                         f"3) Instance is in READY state. Original error: {err_str[:200]}"
            }
        return {"status": "FAILED", "error": err_str[:500]}

    try:
        conn.autocommit = True
        cursor = conn.cursor()
        cursor.execute(sql_text)

        try:
            rows = cursor.fetchall()
            cols = [d[0] for d in cursor.description]
            result = [dict(zip(cols, row)) for row in rows]
            conn.close()
            return {"status": "SUCCESS", "columns": cols, "rows": result, "row_count": len(result)}
        except Exception:
            conn.close()
            return {"status": "SUCCESS", "message": "Query executed (no result set)", "row_count": 0}

    except Exception as e:
        try:
            conn.close()
        except Exception:
            pass
        return {"status": "FAILED", "error": str(e)[:500]}
