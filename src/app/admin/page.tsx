"use client"

import { useState, useEffect } from "react"
import { useInstance } from "@/components/instance-provider"
import { Plus, Trash2, CheckCircle, XCircle, AlertTriangle, Loader2, Plug, Copy } from "lucide-react"

interface Instance {
  INSTANCE_ID: number
  INSTANCE_NAME: string
  PG_HOST: string
  PG_PORT: number
  PG_DATABASE: string
  PG_SERVICE_USER: string
  ENABLED: boolean
}

export default function AdminPage() {
  const { instances, refresh } = useInstance()
  const [showAdd, setShowAdd] = useState(false)
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null)
  const [testResults, setTestResults] = useState<Record<number, { status: string; message: string }>>({})
  const [testing, setTesting] = useState<number | null>(null)

  async function testConnection(id: number) {
    setTesting(id)
    const res = await fetch("/api/admin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "test_connection", instance_id: id }) })
    const data = await res.json()
    if (data.status === "connected") {
      setTestResults(prev => ({ ...prev, [id]: { status: "ok", message: `Connected as ${data.user} to ${data.db}` } }))
    } else {
      setTestResults(prev => ({ ...prev, [id]: { status: "error", message: data.error || "Connection failed" } }))
    }
    setTesting(null)
  }

  async function removeInstance(id: number) {
    const res = await fetch("/api/admin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "remove_instance", instance_id: id }) })
    const data = await res.json()
    if (data.error) setFeedback({ type: "error", message: data.error })
    else { setFeedback({ type: "success", message: "Instance removed" }); refresh() }
  }

  // Group by host
  const grouped = (instances as Instance[]).reduce((acc: Record<string, Instance[]>, inst) => {
    const key = inst.PG_HOST
    if (!acc[key]) acc[key] = []
    acc[key].push(inst)
    return acc
  }, {})

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Admin</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage Postgres instances and connectivity</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="btn-primary"><Plus size={14} /> Add Instance</button>
      </div>

      {feedback && (
        <div className={`p-3 rounded-md text-sm border ${feedback.type === "success" ? "bg-green-50 border-green-200 dark:bg-green-950 dark:border-green-800" : "bg-red-50 border-red-200 dark:bg-red-950 dark:border-red-800"}`}>
          {feedback.message}
          <button onClick={() => setFeedback(null)} className="ml-2 text-xs underline">dismiss</button>
        </div>
      )}

      <div className="space-y-4">
        {Object.entries(grouped).map(([host, insts]) => (
          <div key={host} className="border rounded-md p-4">
            <h3 className="font-semibold">{insts[0].INSTANCE_NAME}</h3>
            <p className="text-xs font-mono text-muted-foreground">{host}</p>
            <div className="mt-3 space-y-1">
              {insts.map(inst => {
                const result = testResults[inst.INSTANCE_ID]
                return (
                  <div key={inst.INSTANCE_ID} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-muted/30">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-mono">{inst.PG_DATABASE}</span>
                      <span className="text-xs text-muted-foreground">({inst.PG_SERVICE_USER})</span>
                      {result && (
                        result.status === "ok"
                          ? <CheckCircle size={12} className="text-green-600" />
                          : <XCircle size={12} className="text-red-500" title={result.message} />
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={() => testConnection(inst.INSTANCE_ID)} disabled={testing === inst.INSTANCE_ID} className="text-xs px-2 py-1 rounded border hover:bg-muted">
                        {testing === inst.INSTANCE_ID ? <Loader2 size={10} className="animate-spin" /> : <Plug size={10} />}
                      </button>
                      <button onClick={() => removeInstance(inst.INSTANCE_ID)} className="text-xs px-2 py-1 rounded border hover:bg-muted text-red-500">
                        <Trash2 size={10} />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
        {instances.length === 0 && (
          <div className="border rounded-md p-8 text-center text-muted-foreground text-sm">No Postgres instances configured.</div>
        )}
      </div>

      {showAdd && <AddInstanceModal onClose={() => { setShowAdd(false); refresh() }} />}
    </div>
  )
}

function AddInstanceModal({ onClose }: { onClose: () => void }) {
  const { refresh } = useInstance()
  const [pgInstances, setPgInstances] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedInstance, setSelectedInstance] = useState("")
  const [selectedHost, setSelectedHost] = useState("")
  const [loadError, setLoadError] = useState("")

  // Credentials
  const [username, setUsername] = useState("snowflake_admin")
  const [password, setPassword] = useState("")

  // Test connection
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  // Databases
  const [databases, setDatabases] = useState<string[]>([])
  const [selectedDbs, setSelectedDbs] = useState<Set<string>>(new Set())

  // Submit
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    fetch("/api/admin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "list_pg_instances" }) })
      .then(r => r.json())
      .then(data => {
        setPgInstances(data.instances || [])
        if (data.error) setLoadError(data.error)
        setLoading(false)
      })
      .catch(e => { setLoadError(e.message); setLoading(false) })
  }, [])

  async function testConnection() {
    if (!password) { setTestResult({ ok: false, message: "Password is required" }); return }
    setTesting(true)
    setTestResult(null)
    setDatabases([])
    setSelectedDbs(new Set())
    try {
      const res = await fetch("/api/admin", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test_new_connection", host: selectedHost, username, password }),
      })
      const data = await res.json()
      if (data.status === "connected") {
        setTestResult({ ok: true, message: `Connected as ${data.user} to ${data.db}` })
        // Show databases from response
        const dbs = data.databases || []
        setDatabases(dbs)
        setSelectedDbs(new Set(dbs))
      } else {
        setTestResult({ ok: false, message: data.error || "Connection failed" })
      }
    } catch (e: any) {
      setTestResult({ ok: false, message: e.message || "Request failed" })
    }
    setTesting(false)
  }

  async function handleAdd() {
    setSubmitting(true)
    setError("")
    const dbs = selectedDbs.size > 0 ? Array.from(selectedDbs) : ["postgres"]
    const res = await fetch("/api/admin", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "add_instance", name: selectedInstance, host: selectedHost, port: 5432,
        database: dbs[0], databases: dbs, service_user: username, password,
      }),
    })
    const data = await res.json()
    setSubmitting(false)
    if (data.error) { setError(data.error); return }
    refresh()
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-background border rounded-lg p-6 w-full max-w-lg max-h-[85vh] overflow-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Add Postgres Instance</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">✕</button>
        </div>

        <div className="space-y-4">
          {/* Instance selector */}
          <div>
            <label className="text-xs font-medium block mb-1">Postgres Instance</label>
            {loadError && <div className="text-xs text-red-600 bg-red-50 dark:bg-red-950 rounded p-2 mb-2">Error: {loadError}</div>}
            {loading ? <div className="text-sm text-muted-foreground animate-pulse">Loading instances...</div> : (
              <div className="space-y-1 max-h-[180px] overflow-auto border rounded p-2">
                {pgInstances.length === 0 && <div className="text-sm text-muted-foreground p-1">No instances found.</div>}
                {pgInstances.map(inst => (
                  <label key={inst.name} className={`flex items-center gap-3 p-2 rounded cursor-pointer ${selectedInstance === inst.name ? "bg-primary/10 border border-primary" : "hover:bg-muted/50"}`}>
                    <input type="radio" name="pg_instance" checked={selectedInstance === inst.name} onChange={() => { setSelectedInstance(inst.name); setSelectedHost(inst.host); setTestResult(null) }} />
                    <div>
                      <span className="font-medium text-sm">{inst.name}</span>
                      <span className={`ml-2 text-xs px-1.5 py-0.5 rounded ${inst.state === "READY" ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"}`}>{inst.state}</span>
                      <div className="text-xs text-muted-foreground font-mono truncate">{inst.host}</div>
                    </div>
                  </label>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-1.5">Not showing up? Run: <code className="text-[11px] font-mono bg-muted px-1 rounded">GRANT OPERATE ON POSTGRES INSTANCE &lt;NAME&gt; TO ROLE SYSADMIN;</code></p>
          </div>

          {/* Credentials */}
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium">Username</span>
              <input value={username} onChange={e => setUsername(e.target.value)} className="input mt-1" />
            </label>
            <label className="block">
              <span className="text-xs font-medium">Password</span>
              <input type="password" value={password} onChange={e => { setPassword(e.target.value); setTestResult(null) }} className="input mt-1" placeholder="From RESET ACCESS" />
            </label>
          </div>

          {/* Test connection */}
          <div className="flex items-center gap-3">
            <button onClick={testConnection} disabled={!selectedInstance || !password || testing} className="btn-secondary flex items-center gap-1.5">
              {testing ? <Loader2 size={14} className="animate-spin" /> : <Plug size={14} />}
              {testing ? "Testing..." : "Test Connection"}
            </button>
            {testResult && (
              <div className={`flex items-center gap-1.5 text-sm ${testResult.ok ? "text-green-600" : "text-red-600"}`}>
                {testResult.ok ? <CheckCircle size={14} /> : <XCircle size={14} />}
                <span>{testResult.message}</span>
              </div>
            )}
          </div>

          {/* Database selection - shown after successful test */}
          {testResult?.ok && databases.length > 0 && (
            <div>
              <label className="text-xs font-medium block mb-1">Databases</label>
              <div className="border rounded max-h-[150px] overflow-auto">
                  {databases.map(db => (
                    <label key={db} className="flex items-center gap-2 px-3 py-1.5 hover:bg-muted/30 cursor-pointer border-b last:border-b-0">
                      <input type="checkbox" checked={selectedDbs.has(db)} onChange={() => {
                        const next = new Set(selectedDbs)
                        next.has(db) ? next.delete(db) : next.add(db)
                        setSelectedDbs(next)
                      }} className="rounded" />
                      <span className="font-mono text-sm">{db}</span>
                    </label>
                  ))}
              </div>
            </div>
          )}

          {/* Error */}
          {error && <div className="text-xs text-red-600 bg-red-50 dark:bg-red-950 rounded p-2">{error}</div>}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-3 border-t">
            <button onClick={onClose} className="btn-secondary">Cancel</button>
            <button onClick={handleAdd} disabled={!testResult?.ok || submitting || selectedDbs.size === 0} className="btn-primary">
              {submitting ? "Adding..." : `Add Instance (${selectedDbs.size} db${selectedDbs.size !== 1 ? "s" : ""})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
