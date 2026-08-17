import { querySnowflake } from "@/lib/snowflake"
export const dynamic = "force-dynamic"

const INCREMENTAL_KEY_CANDIDATES = [
  "UPDATED_AT", "MODIFIED_AT", "LAST_MODIFIED", "LAST_UPDATED",
  "CREATED_AT", "INSERTED_AT", "CREATED_ON", "LOADED_AT",
]

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const database = searchParams.get("database")
    const schema = searchParams.get("schema")
    const table = searchParams.get("table")

    if (!database || !schema || !table) {
      return Response.json({ error: "database, schema, and table required" }, { status: 400 })
    }

    const columns = await querySnowflake(
      `SELECT COLUMN_NAME, DATA_TYPE, IS_IDENTITY FROM ${database}.INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = '${schema}' AND TABLE_NAME = '${table}' ORDER BY ORDINAL_POSITION`
    )

    // Find candidate incremental key
    let suggestedKey: string | null = null
    let keyReason = ""

    // Priority 1: known timestamp column names
    for (const candidate of INCREMENTAL_KEY_CANDIDATES) {
      const match = columns.find((c: any) => c.COLUMN_NAME === candidate)
      if (match && (match.DATA_TYPE.includes("TIMESTAMP") || match.DATA_TYPE === "DATE")) {
        suggestedKey = candidate
        keyReason = `Timestamp column "${candidate}" detected`
        break
      }
    }

    // Priority 2: any timestamp column with "update" or "modified" in the name
    if (!suggestedKey) {
      const tsCol = columns.find((c: any) =>
        (c.DATA_TYPE.includes("TIMESTAMP") || c.DATA_TYPE === "DATE") &&
        (c.COLUMN_NAME.includes("UPDATE") || c.COLUMN_NAME.includes("MODIF"))
      )
      if (tsCol) {
        suggestedKey = tsCol.COLUMN_NAME
        keyReason = `Timestamp column "${tsCol.COLUMN_NAME}" looks like a change tracker`
      }
    }

    // Priority 3: identity/autoincrement column
    if (!suggestedKey) {
      const idCol = columns.find((c: any) => c.IS_IDENTITY === "YES")
      if (idCol) {
        suggestedKey = idCol.COLUMN_NAME
        keyReason = `Identity column "${idCol.COLUMN_NAME}" (append-only pattern)`
      }
    }

    // Priority 4: any timestamp column at all
    if (!suggestedKey) {
      const anyTs = columns.find((c: any) => c.DATA_TYPE.includes("TIMESTAMP"))
      if (anyTs) {
        suggestedKey = anyTs.COLUMN_NAME
        keyReason = `Timestamp column "${anyTs.COLUMN_NAME}" (best available candidate)`
      }
    }

    return Response.json({
      columns: columns.map((c: any) => ({ name: c.COLUMN_NAME, type: c.DATA_TYPE, isIdentity: c.IS_IDENTITY === "YES" })),
      suggestedKey,
      keyReason,
      hasCandidate: !!suggestedKey,
    })
  } catch (e) {
    console.error("[columns]", e)
    return Response.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 })
  }
}
