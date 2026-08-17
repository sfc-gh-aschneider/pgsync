import json
import time


def run(session, instance_id):
    configs = session.sql(
        f"SELECT CONFIG_ID FROM PGSYNC_DB.METADATA.SYNC_CONFIG_DATA "
        f"WHERE INSTANCE_ID = {instance_id} AND ENABLED = TRUE"
    ).collect()

    results = []
    for cfg in configs:
        cid = cfg["CONFIG_ID"]
        result = session.sql(f"CALL PGSYNC_DB.PROCEDURES.SYNC_DATA({cid})").collect()
        r = json.loads(result[0][0]) if result else {"status": "FAILED", "error": "No result"}
        results.append({"config_id": cid, **r})

    successes = sum(1 for r in results if r.get("status") == "SUCCESS")
    failures = sum(1 for r in results if r.get("status") == "FAILED")

    return {
        "status": "SUCCESS" if failures == 0 else ("PARTIAL" if successes > 0 else "FAILED"),
        "total": len(results),
        "successes": successes,
        "failures": failures,
        "details": results
    }
