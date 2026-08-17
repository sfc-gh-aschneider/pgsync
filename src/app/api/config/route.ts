import { querySnowflake, querySnowflakeLongRunning } from "@/lib/snowflake"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const instances = await querySnowflake(
      "SELECT * FROM PGSYNC_DB.METADATA.SYNC_INSTANCES ORDER BY INSTANCE_ID"
    )
    const dataConfigs = await querySnowflake(
      "SELECT * FROM PGSYNC_DB.METADATA.SYNC_CONFIG_DATA ORDER BY CONFIG_ID"
    )
    const roleConfigs = await querySnowflake(
      "SELECT * FROM PGSYNC_DB.METADATA.SYNC_CONFIG_ROLES ORDER BY CONFIG_ID"
    )
    const userConfigs = await querySnowflake(
      "SELECT * FROM PGSYNC_DB.METADATA.SYNC_CONFIG_USERS ORDER BY CONFIG_ID"
    )
    return Response.json({ instances, dataConfigs, roleConfigs, userConfigs })
  } catch (e) {
    console.error("[config]", e)
    return Response.json({ error: e instanceof Error ? e.message : "Failed to load config" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { action, ...params } = body

    let sql = ""
    switch (action) {
      case "add_data_sync":
        sql = `CALL PGSYNC_DB.PROCEDURES.ADD_DATA_SYNC(${params.instance_id}, '${params.direction}', ${params.source_database ? `'${params.source_database}'` : "NULL"}, '${params.source_schema}', '${params.source_object}', ${params.target_database ? `'${params.target_database}'` : "NULL"}, '${params.target_schema}', '${params.target_table}', '${params.sync_mode}', ${params.incremental_key ? `'${params.incremental_key}'` : "NULL"})`
        break
      case "bulk_add_data_sync": {
        const items = params.items as Array<{source_database: string, source_schema: string, source_object: string, target_schema: string, target_table: string}>
        const results = []
        for (const item of items) {
          const itemSql = `CALL PGSYNC_DB.PROCEDURES.ADD_DATA_SYNC(${params.instance_id}, '${params.direction}', '${item.source_database}', '${item.source_schema}', '${item.source_object}', ${params.target_database ? `'${params.target_database}'` : "NULL"}, '${item.target_schema}', '${item.target_table}', '${params.sync_mode}', ${params.incremental_key ? `'${params.incremental_key}'` : "NULL"})`
          try {
            await querySnowflake(itemSql)
            results.push({ object: item.source_object, status: "OK" })
          } catch (e: any) {
            results.push({ object: item.source_object, status: "FAILED", error: e.message })
          }
        }
        return Response.json({ success: true, results, added: results.filter(r => r.status === "OK").length })
      }
      case "bulk_add_data_sync_v2": {
        const items = params.items as Array<{source_database: string, source_schema: string, source_object: string, target_schema: string, target_table: string, sync_mode: string, incremental_key: string | null}>
        const results = []
        for (const item of items) {
          const itemSql = `CALL PGSYNC_DB.PROCEDURES.ADD_DATA_SYNC(${params.instance_id}, '${params.direction}', '${item.source_database}', '${item.source_schema}', '${item.source_object}', ${params.target_database ? `'${params.target_database}'` : "NULL"}, '${item.target_schema}', '${item.target_table}', '${item.sync_mode}', ${item.incremental_key ? `'${item.incremental_key}'` : "NULL"})`
          try {
            await querySnowflake(itemSql)
            results.push({ object: item.source_object, status: "OK" })
          } catch (e: any) {
            results.push({ object: item.source_object, status: "FAILED", error: e.message })
          }
        }
        return Response.json({ success: true, results, added: results.filter(r => r.status === "OK").length })
      }
      case "add_role_sync":
        sql = `CALL PGSYNC_DB.PROCEDURES.ADD_ROLE_SYNC(${params.instance_id}, '${params.snowflake_role}', '${params.pg_role}', ${params.sync_grants})`
        break
      case "add_user_sync":
        sql = `CALL PGSYNC_DB.PROCEDURES.ADD_USER_SYNC(${params.instance_id}, '${params.snowflake_user}', '${params.pg_user}', '${params.auth_mode}', ${params.pg_password ? `'${params.pg_password}'` : "NULL"}, ${params.roles ? `ARRAY_CONSTRUCT(${params.roles.map((r: string) => `'${r}'`).join(",")})` : "NULL"})`
        break
      case "toggle_data_sync":
        sql = `UPDATE PGSYNC_DB.METADATA.SYNC_CONFIG_DATA SET ENABLED = ${params.enabled}, UPDATED_AT = CURRENT_TIMESTAMP() WHERE CONFIG_ID = ${params.config_id}`
        break
      case "toggle_role_sync":
        sql = `UPDATE PGSYNC_DB.METADATA.SYNC_CONFIG_ROLES SET ENABLED = ${params.enabled}, UPDATED_AT = CURRENT_TIMESTAMP() WHERE CONFIG_ID = ${params.config_id}`
        break
      case "delete_data_sync":
        sql = `DELETE FROM PGSYNC_DB.METADATA.SYNC_CONFIG_DATA WHERE CONFIG_ID = ${params.config_id}`
        break
      case "delete_role_sync":
        sql = `DELETE FROM PGSYNC_DB.METADATA.SYNC_CONFIG_ROLES WHERE CONFIG_ID = ${params.config_id}`
        break
      case "delete_user_sync":
        sql = `DELETE FROM PGSYNC_DB.METADATA.SYNC_CONFIG_USERS WHERE CONFIG_ID = ${params.config_id}`
        break
      default:
        return Response.json({ error: "Unknown action" }, { status: 400 })
    }

    const result = await querySnowflake(sql)
    return Response.json({ success: true, result })
  } catch (e) {
    console.error("[config POST]", e)
    return Response.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 })
  }
}
