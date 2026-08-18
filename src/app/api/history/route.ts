import { querySnowflake } from "@/lib/snowflake"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const limit = parseInt(searchParams.get("limit") || "25")
    const offset = parseInt(searchParams.get("offset") || "0")
    const syncType = searchParams.get("type")
    const status = searchParams.get("status")
    const sourceFilter = searchParams.get("source") || ""

    let where = "1=1"
    if (syncType && syncType !== "ALL") where += ` AND SYNC_TYPE = '${syncType}'`
    if (status && status !== "ALL") where += ` AND STATUS = '${status}'`
    if (sourceFilter) where += ` AND (LOWER(SOURCE_OBJECT) LIKE '%${sourceFilter.toLowerCase().replace(/'/g, "''")}%' OR LOWER(TARGET_OBJECT) LIKE '%${sourceFilter.toLowerCase().replace(/'/g, "''")}%')`

    const countResult = await querySnowflake(
      `SELECT COUNT(*) AS CNT FROM PGSYNC_DB.METADATA.SYNC_HISTORY WHERE ${where}`
    )
    const total = countResult[0]?.CNT || 0

    const rows = await querySnowflake(
      `SELECT HISTORY_ID, INSTANCE_ID, SYNC_TYPE, DIRECTION, STATUS, SOURCE_OBJECT, TARGET_OBJECT, ROW_COUNT_SOURCE, ROW_COUNT_TARGET, ROWS_INSERTED, DURATION_SECONDS, ERROR_MESSAGE, DETAILS, CREATED_AT FROM PGSYNC_DB.METADATA.SYNC_HISTORY WHERE ${where} ORDER BY CREATED_AT DESC LIMIT ${limit} OFFSET ${offset}`
    )
    return Response.json({ rows, total, limit, offset })
  } catch (e) {
    console.error("[history]", e)
    return Response.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 })
  }
}
