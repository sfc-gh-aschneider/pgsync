import { querySnowflake } from "@/lib/snowflake"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const limit = searchParams.get("limit") || "50"
    const syncType = searchParams.get("type")
    const status = searchParams.get("status")

    let where = "1=1"
    if (syncType && syncType !== "ALL") where += ` AND SYNC_TYPE = '${syncType}'`
    if (status && status !== "ALL") where += ` AND STATUS = '${status}'`

    const rows = await querySnowflake(
      `SELECT HISTORY_ID, INSTANCE_ID, SYNC_TYPE, DIRECTION, STATUS, SOURCE_OBJECT, TARGET_OBJECT, ROW_COUNT_SOURCE, ROW_COUNT_TARGET, ROWS_INSERTED, DURATION_SECONDS, ERROR_MESSAGE, DETAILS, CREATED_AT FROM PGSYNC_DB.METADATA.SYNC_HISTORY WHERE ${where} ORDER BY CREATED_AT DESC LIMIT ${limit}`
    )
    return Response.json(rows)
  } catch (e) {
    console.error("[history]", e)
    return Response.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 })
  }
}
