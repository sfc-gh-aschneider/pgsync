import json


def run(session, instance_id):
    results = {}

    # Data sync
    data_result = session.sql(f"CALL PGSYNC_DB.PROCEDURES.SYNC_ALL_DATA({instance_id})").collect()
    results["data_sync"] = json.loads(data_result[0][0]) if data_result else {"status": "FAILED"}

    # Role sync
    role_result = session.sql(f"CALL PGSYNC_DB.PROCEDURES.SYNC_ROLES({instance_id})").collect()
    results["role_sync"] = json.loads(role_result[0][0]) if role_result else {"status": "FAILED"}

    # User sync
    user_result = session.sql(f"CALL PGSYNC_DB.PROCEDURES.SYNC_USERS({instance_id})").collect()
    results["user_sync"] = json.loads(user_result[0][0]) if user_result else {"status": "FAILED"}

    all_statuses = [r.get("status", "FAILED") for r in results.values()]
    if all(s == "SUCCESS" for s in all_statuses):
        overall = "SUCCESS"
    elif any(s == "SUCCESS" for s in all_statuses):
        overall = "PARTIAL"
    else:
        overall = "FAILED"

    return {"status": overall, **results}
