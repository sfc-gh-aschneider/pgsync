import { querySnowflakeLongRunning } from "@/lib/snowflake"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { role_name, instance_id } = body

    const result = await querySnowflakeLongRunning(
      `CALL PGSYNC_DB.PROCEDURES.PRECHECK_ROLE('${role_name}', ${instance_id})`
    )
    const row = result[0] || {}
    // The procedure returns a VARIANT — the column name is PRECHECK_ROLE
    const val = row.PRECHECK_ROLE || row.precheck_role || Object.values(row)[0]
    let parsed = val
    if (typeof val === "string") {
      try { parsed = JSON.parse(val) } catch {}
    }
    return Response.json({ success: true, result: parsed })
  } catch (e) {
    console.error("[precheck]", e)
    return Response.json({ error: e instanceof Error ? e.message : "Precheck failed" }, { status: 500 })
  }
}
