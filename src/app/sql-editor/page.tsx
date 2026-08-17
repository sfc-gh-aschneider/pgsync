"use client"

import { useState } from "react"
import { Play, Clock } from "lucide-react"
import { useInstance } from "@/components/instance-provider"

export default function SqlEditorPage() {
  const { selectedInstance, selectedInstanceName } = useInstance()
  const [sql, setSql] = useState("SELECT current_user, version();")
  const [result, setResult] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [history, setHistory] = useState<Array<{ sql: string, time: string, status: string }>>([])

  async function runQuery() {
    if (!sql.trim()) return
    setLoading(true)
    setResult(null)
    const start = Date.now()
    const res = await fetch("/api/pg", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instance_id: selectedInstance, sql: sql.trim() }),
    })
    const data = await res.json()
    const elapsed = ((Date.now() - start) / 1000).toFixed(1)
    setResult({ ...data, elapsed })
    setHistory(prev => [{ sql: sql.trim(), time: `${elapsed}s`, status: data.status || "OK" }, ...prev.slice(0, 19)])
    setLoading(false)
  }

  return (
    <div className="space-y-4 h-full flex flex-col">
      <div>
        <h1 className="text-2xl font-bold">SQL Editor</h1>
        <p className="text-sm text-muted-foreground mt-1">Run SQL directly against <strong>{selectedInstanceName}</strong></p>
      </div>

      <div className="flex-1 flex flex-col gap-3 min-h-0">
        {/* Editor */}
        <div className="border rounded-md overflow-hidden">
          <div className="flex items-center justify-between p-2 bg-muted/50 border-b">
            <span className="text-xs font-medium">Query</span>
            <button onClick={runQuery} disabled={loading || !sql.trim()} className="btn-primary text-xs">
              <Play size={12} /> {loading ? "Running..." : "Run (Ctrl+Enter)"}
            </button>
          </div>
          <textarea
            value={sql}
            onChange={(e) => setSql(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); runQuery() } }}
            className="w-full p-3 font-mono text-sm bg-background resize-none focus:outline-none min-h-[120px]"
            placeholder="SELECT * FROM pgsync.venue_squiggle_lkp LIMIT 10;"
            spellCheck={false}
          />
        </div>

        {/* Results */}
        <div className="flex-1 border rounded-md overflow-auto min-h-[200px]">
          {!result && !loading && (
            <div className="p-8 text-center text-sm text-muted-foreground">Run a query to see results</div>
          )}
          {loading && (
            <div className="p-8 text-center text-sm text-muted-foreground animate-pulse">Executing query...</div>
          )}
          {result && result.status === "FAILED" && (
            <div className="p-4">
              <div className="text-sm text-red-600 font-medium">Error</div>
              <pre className="text-xs text-red-500 mt-2 whitespace-pre-wrap">{result.error}</pre>
            </div>
          )}
          {result && result.status === "SUCCESS" && result.rows && (
            <>
              <div className="p-2 bg-muted/50 border-b sticky top-0 flex justify-between items-center">
                <span className="text-xs text-muted-foreground">{result.row_count} row{result.row_count !== 1 ? "s" : ""} returned</span>
                <span className="text-xs text-muted-foreground flex items-center gap-1"><Clock size={10} /> {result.elapsed}s</span>
              </div>
              <div className="overflow-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/30">
                    <tr>
                      {result.columns?.map((col: string) => (
                        <th key={col} className="text-left p-2 font-medium border-b whitespace-nowrap">{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((row: any, i: number) => (
                      <tr key={i} className="border-b hover:bg-muted/20">
                        {result.columns?.map((col: string) => (
                          <td key={col} className="p-2 whitespace-nowrap max-w-[300px] truncate font-mono">
                            {row[col] != null ? String(row[col]) : <span className="text-muted-foreground italic">null</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {result && result.status === "SUCCESS" && result.message && (
            <div className="p-4 text-sm text-green-600">{result.message}</div>
          )}
        </div>

        {/* History */}
        {history.length > 0 && (
          <div className="border rounded-md p-2 max-h-[100px] overflow-auto">
            <span className="text-xs font-medium text-muted-foreground">Recent queries</span>
            {history.map((h, i) => (
              <button key={i} onClick={() => setSql(h.sql)} className="block w-full text-left text-xs font-mono px-2 py-0.5 hover:bg-muted rounded truncate">
                {h.sql} <span className="text-muted-foreground">({h.time})</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
