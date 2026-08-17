"use client"

import { useState, useEffect } from "react"
import { History, Filter } from "lucide-react"

export default function HistoryPage() {
  const [history, setHistory] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [typeFilter, setTypeFilter] = useState("ALL")
  const [statusFilter, setStatusFilter] = useState("ALL")

  useEffect(() => { loadHistory() }, [typeFilter, statusFilter])

  async function loadHistory() {
    setLoading(true)
    const params = new URLSearchParams({ limit: "100", type: typeFilter, status: statusFilter })
    const res = await fetch(`/api/history?${params}`)
    const data = await res.json()
    setHistory(data)
    setLoading(false)
  }

  const successes = history.filter((r: any) => r.STATUS === "SUCCESS").length
  const failures = history.filter((r: any) => r.STATUS === "FAILED").length
  const partials = history.filter((r: any) => r.STATUS === "PARTIAL").length

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Sync History</h1>
        <p className="text-sm text-muted-foreground mt-1">Audit log of all sync operations</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="border rounded-lg p-3 text-center">
          <div className="text-xl font-bold text-green-600">{successes}</div>
          <div className="text-xs text-muted-foreground">Successful</div>
        </div>
        <div className="border rounded-lg p-3 text-center">
          <div className="text-xl font-bold text-yellow-600">{partials}</div>
          <div className="text-xs text-muted-foreground">Partial</div>
        </div>
        <div className="border rounded-lg p-3 text-center">
          <div className="text-xl font-bold text-red-600">{failures}</div>
          <div className="text-xs text-muted-foreground">Failed</div>
        </div>
      </div>

      <div className="flex gap-3 items-center">
        <Filter size={14} className="text-muted-foreground" />
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="input w-auto">
          <option value="ALL">All Types</option>
          <option value="DATA_SYNC">Data Sync</option>
          <option value="ROLE_SYNC">Role Sync</option>
          <option value="USER_SYNC">User Sync</option>
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="input w-auto">
          <option value="ALL">All Statuses</option>
          <option value="SUCCESS">Success</option>
          <option value="FAILED">Failed</option>
          <option value="PARTIAL">Partial</option>
        </select>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading...</div>
      ) : (
        <div className="border rounded-md overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left p-2 font-medium">Time</th>
                <th className="text-left p-2 font-medium">Type</th>
                <th className="text-left p-2 font-medium">Direction</th>
                <th className="text-left p-2 font-medium">Status</th>
                <th className="text-left p-2 font-medium">Source</th>
                <th className="text-left p-2 font-medium">Target</th>
                <th className="text-left p-2 font-medium">Rows</th>
                <th className="text-left p-2 font-medium">Duration</th>
                <th className="text-left p-2 font-medium">Error</th>
              </tr>
            </thead>
            <tbody>
              {history.map((row: any, i: number) => (
                <HistoryRow key={i} row={row} />
              ))}
              {history.length === 0 && (
                <tr><td colSpan={9} className="p-4 text-center text-muted-foreground">No history records.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const cls = status === "SUCCESS" ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
    : status === "FAILED" ? "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
    : "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200"
  return <span className={`px-2 py-0.5 rounded text-xs font-medium ${cls}`}>{status}</span>
}

function HistoryRow({ row }: { row: any }) {
  const [expanded, setExpanded] = useState(false)
  const hasDetails = row.ERROR_MESSAGE || row.DETAILS

  return (
    <>
      <tr className={`border-t ${hasDetails ? "cursor-pointer hover:bg-muted/30" : ""}`} onClick={() => hasDetails && setExpanded(!expanded)}>
        <td className="p-2 text-xs text-muted-foreground whitespace-nowrap">
          {hasDetails && <span className="mr-1">{expanded ? "▼" : "▶"}</span>}
          {new Date(row.CREATED_AT).toLocaleString()}
        </td>
        <td className="p-2 text-xs">{row.SYNC_TYPE}</td>
        <td className="p-2 text-xs">{row.DIRECTION || "-"}</td>
        <td className="p-2"><StatusBadge status={row.STATUS} /></td>
        <td className="p-2 font-mono text-xs max-w-[200px] truncate">{row.SOURCE_OBJECT || "-"}</td>
        <td className="p-2 font-mono text-xs max-w-[200px] truncate">{row.TARGET_OBJECT || "-"}</td>
        <td className="p-2 text-xs">{row.ROWS_INSERTED ?? "-"}</td>
        <td className="p-2 text-xs">{row.DURATION_SECONDS ? `${row.DURATION_SECONDS}s` : "-"}</td>
        <td className="p-2 text-xs text-red-600 max-w-[200px] truncate">{row.ERROR_MESSAGE ? "View details" : ""}</td>
      </tr>
      {expanded && (
        <tr className="bg-muted/20">
          <td colSpan={9} className="p-3">
            {row.ERROR_MESSAGE && (
              <div className="mb-2">
                <span className="text-xs font-medium text-red-600">Error:</span>
                <pre className="text-xs mt-1 whitespace-pre-wrap text-red-500 bg-red-50 dark:bg-red-950 p-2 rounded">{row.ERROR_MESSAGE}</pre>
              </div>
            )}
            {row.DETAILS && (
              <div>
                <span className="text-xs font-medium">Details:</span>
                <pre className="text-xs mt-1 whitespace-pre-wrap bg-muted p-2 rounded overflow-auto max-h-[200px]">
                  {typeof row.DETAILS === "string" ? row.DETAILS : JSON.stringify(row.DETAILS, null, 2)}
                </pre>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  )
}
