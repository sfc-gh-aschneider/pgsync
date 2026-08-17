import { querySnowflake, querySnowflakeLongRunning } from "@/lib/snowflake"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const policies = await querySnowflake(
      "SELECT * FROM PGSYNC_DB.METADATA.SYNC_CONFIG_POLICIES ORDER BY POLICY_ID"
    )
    // Also get synced tables for the dropdown
    const syncedTables = await querySnowflake(
      "SELECT DISTINCT TARGET_SCHEMA, TARGET_TABLE FROM PGSYNC_DB.METADATA.SYNC_CONFIG_DATA WHERE ENABLED = TRUE AND DIRECTION = 'SF_TO_PG'"
    )
    // Get PG roles for policy configuration
    const roleConfigs = await querySnowflake(
      "SELECT PG_ROLE FROM PGSYNC_DB.METADATA.SYNC_CONFIG_ROLES WHERE ENABLED = TRUE"
    )
    return Response.json({ policies, syncedTables, roles: roleConfigs.map((r: any) => r.PG_ROLE) })
  } catch (e) {
    console.error("[policies GET]", e)
    return Response.json({ policies: [], syncedTables: [], roles: [] })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { action } = body

    switch (action) {
      case "add": {
        const { instance_id, policy_type, target_schema, target_table, policy_name, policy_definition } = body
        const defJson = JSON.stringify(policy_definition).replace(/'/g, "''")
        await querySnowflake(
          `INSERT INTO PGSYNC_DB.METADATA.SYNC_CONFIG_POLICIES (INSTANCE_ID, POLICY_TYPE, TARGET_SCHEMA, TARGET_TABLE, POLICY_NAME, POLICY_DEFINITION) SELECT ${instance_id}, '${policy_type}', '${target_schema}', '${target_table}', '${policy_name}', PARSE_JSON('${defJson}')`
        )
        return Response.json({ success: true })
      }
      case "apply": {
        const { instance_id } = body
        const rows = await querySnowflakeLongRunning(
          `CALL PGSYNC_DB.PROCEDURES.SYNC_POLICIES(${instance_id})`
        )
        const row = rows[0] || {}
        const firstCol = Object.values(row)[0]
        let result: any
        if (typeof firstCol === "string") {
          try { result = JSON.parse(firstCol) } catch { result = { status: "SUCCESS" } }
        } else {
          result = firstCol
        }
        return Response.json({ success: true, result })
      }
      case "delete": {
        const { policy_id } = body
        await querySnowflake(
          `DELETE FROM PGSYNC_DB.METADATA.SYNC_CONFIG_POLICIES WHERE POLICY_ID = ${policy_id}`
        )
        return Response.json({ success: true })
      }
      case "inspect_sf": {
        // Check for Snowflake row access policies on synced source tables
        const { database } = body
        const policies = await querySnowflake(
          `SELECT * FROM ${database || 'SNOWFLAKE'}.ACCOUNT_USAGE.ROW_ACCESS_POLICIES WHERE DELETED IS NULL`
        )
        const policyRefs = await querySnowflake(
          `SELECT * FROM ${database || 'SNOWFLAKE'}.ACCOUNT_USAGE.POLICY_REFERENCES WHERE POLICY_KIND = 'ROW_ACCESS_POLICY' LIMIT 50`
        )
        return Response.json({ policies, policyRefs })
      }
      default:
        return Response.json({ error: "Unknown action" }, { status: 400 })
    }
  } catch (e) {
    console.error("[policies POST]", e)
    return Response.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 })
  }
}
