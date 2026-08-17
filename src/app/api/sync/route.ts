import { querySnowflakeLongRunning } from "@/lib/snowflake"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { type, config_id, instance_id } = body

    let sql = ""
    switch (type) {
      case "data_single":
        sql = `CALL PGSYNC_DB.PROCEDURES.SYNC_DATA(${config_id})`
        break
      case "data_all":
        sql = `CALL PGSYNC_DB.PROCEDURES.SYNC_ALL_DATA(${instance_id})`
        break
      case "roles":
        sql = `CALL PGSYNC_DB.PROCEDURES.SYNC_ROLES(${instance_id})`
        break
      case "users":
        sql = `CALL PGSYNC_DB.PROCEDURES.SYNC_USERS(${instance_id})`
        break
      case "full":
        sql = `CALL PGSYNC_DB.PROCEDURES.RUN_FULL_SYNC(${instance_id})`
        break
      default:
        return Response.json({ error: "Unknown sync type" }, { status: 400 })
    }

    const rows = await querySnowflakeLongRunning(sql)
    // Stored procedures return VARIANT as { "PROC_NAME": <value> }
    // The value might be a JSON string or already parsed object
    const row = rows[0] || {}
    const firstCol = Object.values(row)[0]
    let result: any
    if (typeof firstCol === "string") {
      try { result = JSON.parse(firstCol) } catch { result = { status: "SUCCESS", raw: firstCol } }
    } else {
      result = firstCol
    }
    return Response.json({ success: true, result })
  } catch (e) {
    console.error("[sync]", e)
    return Response.json({ error: e instanceof Error ? e.message : "Sync failed" }, { status: 500 })
  }
}
