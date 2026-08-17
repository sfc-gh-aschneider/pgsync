import { querySnowflakeLongRunning } from "@/lib/snowflake"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { role_name, instance_id } = body

    const result = await querySnowflakeLongRunning(
      `CALL PGSYNC_DB.PROCEDURES.PRECHECK_ROLE('${role_name}', ${instance_id})`
    )
    return Response.json({ success: true, result: result[0] })
  } catch (e) {
    console.error("[precheck]", e)
    return Response.json({ error: e instanceof Error ? e.message : "Precheck failed" }, { status: 500 })
  }
}
