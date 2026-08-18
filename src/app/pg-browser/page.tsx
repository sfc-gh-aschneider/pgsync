"use client"

import { useState, useEffect } from "react"
import { Table, RefreshCw, ChevronRight } from "lucide-react"
import { useInstance } from "@/components/instance-provider"

interface PgTable {
  table_schema: string
  table_name: string
  table_type: string
  row_count: number | null
  size: string | null
}

export default function PgBrowserPage() {
  const { selectedInstance } = useInstance()
  const [tables, setTables] = useState<PgTable[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedTable, setSelectedTable] = useState<string | null>(null)
  const [tableData, setTableData] = useState<any>(null)
  const [loadingData, setLoadingData] = useState(false)

  useEffect(() => { loadTables() }, [selectedInstance])

  async function loadTables() {
    setLoading(true)
    const res = await fetch("/api/pg", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        instance_id: selectedInstance,
        sql: "SELECT t.table_schema, t.table_name, t.table_type, (SELECT reltuples::bigint FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relname = t.table_name AND n.nspname = t.table_schema) as row_count, pg_size_pretty(pg_total_relation_size(quote_ident(t.table_schema) || '.' || quote_ident(t.table_name))) as size FROM information_schema.tables t WHERE t.table_schema NOT IN ('pg_catalog', 'information_schema', 'snowflake_auth', 'snowflake_cdc', 'lake_engine', 'lake_iceberg', 'lake_table', 'cron', '__pg_lake_table_writes') AND t.table_type = 'BASE TABLE' ORDER BY t.table_schema, t.table_name"
      }),
    })
    const data = await res.json()
    setTables(data.rows || [])
    setLoading(false)
  }

  async function browseTable(schema: string, table: string) {
    const fqn = `${schema}.${table}`
    setSelectedTable(fqn)
    setLoadingData(true)
    const res = await fetch("/api/pg", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        instance_id: selectedInstance,
        sql: `SELECT * FROM ${fqn} LIMIT 100`
      }),
    })
    const data = await res.json()
    setTableData(data)
    setLoadingData(false)
  }

  if (loading) return <div className="text-sm text-muted-foreground">Loading tables...</div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">PG Browser</h1>
          <p className="text-sm text-muted-foreground mt-1">Browse tables and data in your Postgres instance</p>
        </div>
        <button onClick={loadTables} className="btn-secondary"><RefreshCw size={14} /> Refresh</button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {/* Table list */}
        <div className="border rounded-md overflow-auto max-h-[calc(100vh-14rem)]">
          <div className="p-2 bg-muted/50 border-b sticky top-0 z-10">
            <span className="text-xs font-medium">{tables.length} tables</span>
          </div>
          {tables.map((t) => (
            <button
              key={`${t.table_schema}.${t.table_name}`}
              onClick={() => browseTable(t.table_schema, t.table_name)}
              className={`w-full text-left px-3 py-2 text-sm border-b hover:bg-muted/50 flex items-center justify-between ${selectedTable === `${t.table_schema}.${t.table_name}` ? "bg-primary/5 border-l-2 border-l-primary" : ""}`}
            >
              <div>
                <span className="font-mono text-xs">{t.table_schema}.<strong>{t.table_name}</strong></span>
                <div className="flex gap-2 mt-0.5">
                  <span className="text-xs text-muted-foreground">{t.row_count != null ? `${Number(t.row_count).toLocaleString()} rows` : ""}</span>
                  {t.size && <span className="text-xs text-muted-foreground">{t.size}</span>}
                </div>
              </div>
              <ChevronRight size={12} className="text-muted-foreground" />
            </button>
          ))}
          {tables.length === 0 && <div className="p-4 text-center text-sm text-muted-foreground">No tables found in this instance.</div>}
        </div>

        {/* Data viewer */}
        <div className="col-span-2 border rounded-md overflow-auto max-h-[calc(100vh-14rem)]">
          {!selectedTable && <div className="p-8 text-center text-sm text-muted-foreground">Select a table to browse its data</div>}
          {loadingData && <div className="p-8 text-center text-sm text-muted-foreground animate-pulse">Loading data...</div>}
          {tableData && !loadingData && (
            <>
              <div className="p-2 bg-muted/50 border-b sticky top-0 z-10 flex justify-between items-center">
                <span className="text-xs font-medium font-mono">{selectedTable}</span>
                <span className="text-xs text-muted-foreground">{tableData.row_count} rows (showing first 100)</span>
              </div>
              {tableData.rows?.length > 0 ? (
                <div className="overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/30 sticky top-9 z-10">
                      <tr>
                        {tableData.columns?.map((col: string) => (
                          <th key={col} className="text-left p-1.5 font-medium border-b whitespace-nowrap">{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {tableData.rows.map((row: any, i: number) => (
                        <tr key={i} className="border-b hover:bg-muted/20">
                          {tableData.columns?.map((col: string) => (
                            <td key={col} className="p-1.5 whitespace-nowrap max-w-[200px] truncate">{row[col] != null ? String(row[col]) : <span className="text-muted-foreground italic">null</span>}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="p-4 text-center text-sm text-muted-foreground">Table is empty</div>
              )}
              {tableData.error && <div className="p-4 text-center text-sm text-red-600">{tableData.error}</div>}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
