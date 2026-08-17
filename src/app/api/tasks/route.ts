import { querySnowflake } from "@/lib/snowflake"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const tasks = await querySnowflake(
      `SELECT NAME, STATE, SCHEDULE, WAREHOUSE, DATABASE_NAME, SCHEMA_NAME, DEFINITION, LAST_COMMITTED_ON FROM TABLE(INFORMATION_SCHEMA.TASK_HISTORY(RESULT_LIMIT => 20)) WHERE DATABASE_NAME = 'PGSYNC_DB' ORDER BY SCHEDULED_TIME DESC`
    )
    const activeTasks = await querySnowflake(
      `SHOW TASKS IN SCHEMA PGSYNC_DB.TASKS`
    )
    return Response.json({ history: tasks, tasks: activeTasks })
  } catch (e) {
    console.error("[tasks GET]", e)
    return Response.json({ history: [], tasks: [] })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { action, task_name, instance_id, schedule, sync_scope } = body

    let sql = ""
    switch (action) {
      case "create":
        const procCall = sync_scope === "full"
          ? `CALL PGSYNC_DB.PROCEDURES.RUN_FULL_SYNC(${instance_id})`
          : sync_scope === "data"
          ? `CALL PGSYNC_DB.PROCEDURES.SYNC_ALL_DATA(${instance_id})`
          : sync_scope === "roles"
          ? `CALL PGSYNC_DB.PROCEDURES.SYNC_ROLES(${instance_id})`
          : `CALL PGSYNC_DB.PROCEDURES.SYNC_USERS(${instance_id})`
        sql = `CREATE OR REPLACE TASK PGSYNC_DB.TASKS.${task_name} WAREHOUSE = 'DEV_WH' SCHEDULE = '${schedule}' AS ${procCall}`
        await querySnowflake(sql)
        await querySnowflake(`ALTER TASK PGSYNC_DB.TASKS.${task_name} RESUME`)
        break
      case "suspend":
        sql = `ALTER TASK PGSYNC_DB.TASKS.${task_name} SUSPEND`
        await querySnowflake(sql)
        break
      case "resume":
        sql = `ALTER TASK PGSYNC_DB.TASKS.${task_name} RESUME`
        await querySnowflake(sql)
        break
      case "drop":
        sql = `DROP TASK IF EXISTS PGSYNC_DB.TASKS.${task_name}`
        await querySnowflake(sql)
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
