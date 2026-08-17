import { querySnowflake } from "@/lib/snowflake"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const activeTasks = await querySnowflake(
      `SHOW TASKS IN SCHEMA PGSYNC_DB.TASKS`
    )
    return Response.json({ tasks: activeTasks })
  } catch (e) {
    console.error("[tasks GET]", e)
    return Response.json({ tasks: [] })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { action, task_name, instance_id, schedule, sync_scope, config_ids } = body

    switch (action) {
      case "create": {
        let procCall: string

        if (sync_scope === "data_multi" && config_ids && config_ids.length > 0) {
          // Multiple specific data syncs in a BEGIN/END block
          const calls = config_ids.map((id: number) => `  CALL PGSYNC_DB.PROCEDURES.SYNC_DATA(${id});`).join("\n")
          procCall = `BEGIN\n${calls}\nEND;`
        } else if (sync_scope === "data_all") {
          procCall = `CALL PGSYNC_DB.PROCEDURES.SYNC_ALL_DATA(${instance_id})`
        } else if (sync_scope === "roles") {
          procCall = `CALL PGSYNC_DB.PROCEDURES.SYNC_ROLES(${instance_id})`
        } else if (sync_scope === "users") {
          procCall = `CALL PGSYNC_DB.PROCEDURES.SYNC_USERS(${instance_id})`
        } else {
          procCall = `CALL PGSYNC_DB.PROCEDURES.RUN_FULL_SYNC(${instance_id})`
        }

        const sql = `CREATE OR REPLACE TASK PGSYNC_DB.TASKS.${task_name} WAREHOUSE = 'PGSYNC_WH' SCHEDULE = '${schedule}' AS ${procCall}`
        await querySnowflake(sql)
        await querySnowflake(`ALTER TASK PGSYNC_DB.TASKS.${task_name} RESUME`)
        break
      }
      case "suspend":
        await querySnowflake(`ALTER TASK PGSYNC_DB.TASKS.${task_name} SUSPEND`)
        break
      case "resume":
        await querySnowflake(`ALTER TASK PGSYNC_DB.TASKS.${task_name} RESUME`)
        break
      case "drop":
        await querySnowflake(`DROP TASK IF EXISTS PGSYNC_DB.TASKS.${task_name}`)
        break
      default:
        return Response.json({ error: "Unknown action" }, { status: 400 })
    }

    return Response.json({ success: true })
  } catch (e) {
    console.error("[tasks POST]", e)
    return Response.json({ error: e instanceof Error ? e.message : "Task operation failed" }, { status: 500 })
  }
}
