import { querySnowflake } from "@/lib/snowflake"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const level = searchParams.get("level") || "databases"
    const database = searchParams.get("database")
    const schema = searchParams.get("schema")

    switch (level) {
      case "databases": {
        const rows = await querySnowflake(
          "SELECT DATABASE_NAME FROM SNOWFLAKE.INFORMATION_SCHEMA.DATABASES WHERE DATABASE_NAME NOT IN ('SNOWFLAKE', 'SNOWFLAKE_SAMPLE_DATA') ORDER BY DATABASE_NAME"
        )
        return Response.json(rows.map((r: any) => r.DATABASE_NAME))
      }
      case "schemas": {
        if (!database) return Response.json({ error: "database required" }, { status: 400 })
        const rows = await querySnowflake(
          `SELECT SCHEMA_NAME FROM ${database}.INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME != 'INFORMATION_SCHEMA' ORDER BY SCHEMA_NAME`
        )
        return Response.json(rows.map((r: any) => r.SCHEMA_NAME))
      }
      case "tables": {
        if (!database || !schema) return Response.json({ error: "database and schema required" }, { status: 400 })
        const rows = await querySnowflake(
          `SELECT TABLE_NAME, TABLE_TYPE, ROW_COUNT FROM ${database}.INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = '${schema}' AND TABLE_TYPE IN ('BASE TABLE', 'VIEW') ORDER BY TABLE_NAME`
        )
        return Response.json(rows)
      }
      case "roles": {
        const SYSTEM_ROLES = ["ACCOUNTADMIN", "SYSADMIN", "SECURITYADMIN", "USERADMIN", "PUBLIC", "ORGADMIN"]
        const rows = await querySnowflake("SHOW ROLES")
        const filtered = rows
          .filter((r: any) => !SYSTEM_ROLES.includes(r.name))
          .map((r: any) => ({ name: r.name, granted_roles: r.granted_roles, assigned_to_users: r.assigned_to_users }))
        return Response.json(filtered)
      }
      case "users": {
        const rows = await querySnowflake("SHOW USERS")
        const users = rows.map((r: any) => ({ name: r.name, login_name: r.login_name, email: r.email, disabled: r.disabled }))
        return Response.json(users)
      }
      default:
        return Response.json({ error: "Invalid level" }, { status: 400 })
    }
  } catch (e) {
    console.error("[browse]", e)
    return Response.json({ error: e instanceof Error ? e.message : "Browse failed" }, { status: 500 })
  }
}
