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
          const srcDb = item.source_database ? `'${item.source_database}'` : "NULL"
          const tgtDb = params.target_database ? `'${params.target_database}'` : "NULL"
          const incKey = params.incremental_key ? `'${params.incremental_key}'` : "NULL"
          const itemSql = `INSERT INTO PGSYNC_DB.METADATA.SYNC_CONFIG_DATA (INSTANCE_ID, DIRECTION, SOURCE_DATABASE, SOURCE_SCHEMA, SOURCE_OBJECT, TARGET_DATABASE, TARGET_SCHEMA, TARGET_TABLE, SYNC_MODE, INCREMENTAL_KEY, ENABLED) VALUES (${params.instance_id}, '${params.direction}', ${srcDb}, '${item.source_schema}', '${item.source_object}', ${tgtDb}, '${item.target_schema}', '${item.target_table}', '${params.sync_mode}', ${incKey}, TRUE)`
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
        const items = params.items as Array<{source_database: string | null, source_schema: string, source_object: string, target_database?: string | null, target_schema: string, target_table: string, sync_mode: string, incremental_key: string | null}>
        const results = []
        for (const item of items) {
          const targetDb = item.target_database || params.target_database || null
          const srcDb = item.source_database ? `'${item.source_database}'` : "NULL"
          const tgtDb = targetDb ? `'${targetDb}'` : "NULL"
          const incKey = item.incremental_key ? `'${item.incremental_key}'` : "NULL"
          const itemSql = `INSERT INTO PGSYNC_DB.METADATA.SYNC_CONFIG_DATA (INSTANCE_ID, DIRECTION, SOURCE_DATABASE, SOURCE_SCHEMA, SOURCE_OBJECT, TARGET_DATABASE, TARGET_SCHEMA, TARGET_TABLE, SYNC_MODE, INCREMENTAL_KEY, ENABLED) VALUES (${params.instance_id}, '${params.direction}', ${srcDb}, '${item.source_schema}', '${item.source_object}', ${tgtDb}, '${item.target_schema}', '${item.target_table}', '${item.sync_mode}', ${incKey}, TRUE)`
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
        sql = `INSERT INTO PGSYNC_DB.METADATA.SYNC_CONFIG_ROLES (INSTANCE_ID, SNOWFLAKE_ROLE, PG_ROLE, SYNC_GRANTS, ENABLED) VALUES (${params.instance_id}, '${params.snowflake_role}', '${params.pg_role}', ${params.sync_grants}, TRUE)`
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
