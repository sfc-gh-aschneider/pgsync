import { querySnowflakeLongRunning } from "@/lib/snowflake"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  try {
    const { instance_id, sql } = await request.json()
    if (!sql) return Response.json({ error: "SQL required" }, { status: 400 })

    const rows = await querySnowflakeLongRunning(
      `CALL PGSYNC_DB.PROCEDURES.PG_QUERY(${instance_id || 1}, '${sql.replace(/'/g, "''")}')`
    )
    const row = rows[0] || {}
    const firstCol = Object.values(row)[0]
    let result: any
    if (typeof firstCol === "string") {
      try { result = JSON.parse(firstCol) } catch { result = { status: "SUCCESS", raw: firstCol } }
    } else {
      result = firstCol
    }
    return Response.json(result)
  } catch (e) {
    console.error("[pg query]", e)
    return Response.json({ status: "FAILED", error: e instanceof Error ? e.message : "Query failed" }, { status: 500 })
  }
}
