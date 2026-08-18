"use client"

import { useState, useEffect } from "react"
import { Filter, ChevronLeft, ChevronRight, Search } from "lucide-react"

const PAGE_SIZE = 25

export default function HistoryPage() {
  const [history, setHistory] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(true)
  const [typeFilter, setTypeFilter] = useState("ALL")
  const [statusFilter, setStatusFilter] = useState("ALL")
  const [sourceFilter, setSourceFilter] = useState("")
  const [searchInput, setSearchInput] = useState("")

  useEffect(() => { setOffset(0) }, [typeFilter, statusFilter, sourceFilter])
  useEffect(() => { loadHistory() }, [typeFilter, statusFilter, sourceFilter, offset])

  async function loadHistory() {
    setLoading(true)
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(offset),
      type: typeFilter,
      status: statusFilter,
      source: sourceFilter,
    })
    const res = await fetch(`/api/history?${params}`)
    const data = await res.json()
    setHistory(data.rows || [])
    setTotal(data.total || 0)
    setLoading(false)
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    setSourceFilter(searchInput)
  }

  const page = Math.floor(offset / PAGE_SIZE) + 1
  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Sync History</h1>
        <p className="text-sm text-muted-foreground mt-1">Audit log of all sync operations</p>
      </div>

      <div className="flex flex-wrap gap-3 items-center">
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
          <option value="IN_PROGRESS">In Progress</option>
        </select>
        <form onSubmit={handleSearch} className="flex items-center gap-1">
          <div className="relative">
            <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Filter source/target..."
              className="input pl-7 w-48"
            />
          </div>
          <button type="submit" className="btn-secondary text-xs">Go</button>
          {sourceFilter && <button type="button" onClick={() => { setSearchInput(""); setSourceFilter("") }} className="text-xs text-muted-foreground hover:text-foreground underline">Clear</button>}
        </form>
        <span className="ml-auto text-xs text-muted-foreground">{total} records</span>
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
                <HistoryRow key={row.HISTORY_ID || i} row={row} />
              ))}
              {history.length === 0 && (
                <tr><td colSpan={9} className="p-4 text-center text-muted-foreground">No history records.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
          </span>
          <div className="flex items-center gap-2">
            <button onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} disabled={offset === 0} className="btn-secondary p-1.5"><ChevronLeft size={14} /></button>
            <span className="text-xs">Page {page} / {totalPages}</span>
            <button onClick={() => setOffset(offset + PAGE_SIZE)} disabled={offset + PAGE_SIZE >= total} className="btn-secondary p-1.5"><ChevronRight size={14} /></button>
          </div>
        </div>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const cls = status === "SUCCESS" ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
    : status === "FAILED" ? "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
    : status === "IN_PROGRESS" ? "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
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
          {new Date(row.CREATED_AT).toLocaleString("en-AU", { timeZone: "Australia/Melbourne" })}
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
