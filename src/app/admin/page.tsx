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
  const [step, setStep] = useState<"select" | "validate" | "databases" | "credentials">("select")
  const [pgInstances, setPgInstances] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedInstance, setSelectedInstance] = useState("")
  const [selectedHost, setSelectedHost] = useState("")

  // Validation
  const [validating, setValidating] = useState(false)
  const [checks, setChecks] = useState<any[]>([])
  const [passed, setPassed] = useState(false)
  const [commands, setCommands] = useState<string[]>([])

  // Databases
  const [databases, setDatabases] = useState<string[]>([])
  const [selectedDbs, setSelectedDbs] = useState<Set<string>>(new Set())
  const [loadingDbs, setLoadingDbs] = useState(false)

  // Credentials
  const [username, setUsername] = useState("snowflake_admin")
  const [password, setPassword] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    fetch("/api/admin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "list_pg_instances" }) })
      .then(r => r.json())
      .then(data => { setPgInstances(data.instances || []); setLoading(false) })
  }, [])

  async function validate() {
    setValidating(true)
    setChecks([])
    setCommands([])
    const res = await fetch("/api/admin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "validate_instance", instance_name: selectedInstance }) })
    const data = await res.json()
    setChecks(data.checks || [])
    setPassed(data.passed || false)
    setCommands(data.commands || [])
    if (data.host) setSelectedHost(data.host)
    setValidating(false)
  }

  async function loadDatabases() {
    // We need a temporary instance to query databases - use the first existing one that matches this host, or we'll query after adding
    // For now, skip to credentials since we can list DBs after creating the instance
    setStep("credentials")
  }

  async function handleSubmit() {
    if (!password) { setError("Password is required"); return }
    setSubmitting(true)
    setError("")

    // First add with 'postgres' db to get connectivity, then list databases
    const res = await fetch("/api/admin", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "add_instance",
        name: selectedInstance,
        host: selectedHost,
        port: 5432,
        database: "postgres",
        databases: selectedDbs.size > 0 ? Array.from(selectedDbs) : ["postgres"],
        service_user: username,
        password,
      }),
    })
    const data = await res.json()
    setSubmitting(false)
    if (data.error) { setError(data.error); return }
    onClose()
  }

  async function fetchDatabases() {
    setLoadingDbs(true)
    // Need to create a temp connection - add instance with just 'postgres' first, list dbs, then let user pick
    // Actually we can just proceed - add_instance handles multi-db via the databases array
    // Let's add the instance first with postgres, get its ID, then list databases
    const addRes = await fetch("/api/admin", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "add_instance", name: selectedInstance, host: selectedHost, port: 5432,
        database: "postgres", databases: ["postgres"], service_user: username, password,
      }),
    })
    const addData = await addRes.json()
    if (addData.error) { setError(addData.error); setLoadingDbs(false); return }

    // Now find the instance_id
    const cfgRes = await fetch("/api/config")
    const cfgData = await cfgRes.json()
    const inst = (cfgData.instances || []).find((i: any) => i.PG_HOST === selectedHost && i.PG_DATABASE === "postgres")
    if (!inst) { setError("Instance added but couldn't find it to list databases"); setLoadingDbs(false); return }

    // List databases
    const dbRes = await fetch("/api/admin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "list_databases", instance_id: inst.INSTANCE_ID }) })
    const dbData = await dbRes.json()
    setDatabases(dbData.databases || [])
    setSelectedDbs(new Set(dbData.databases || []))
    setLoadingDbs(false)
    setStep("databases")
  }

  async function addSelectedDatabases() {
    setSubmitting(true)
    // Add remaining databases (postgres already added)
    const remaining = Array.from(selectedDbs).filter(db => db !== "postgres")
    if (remaining.length > 0) {
      await fetch("/api/admin", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add_instance", name: selectedInstance, host: selectedHost, port: 5432,
          databases: remaining, service_user: username, password,
        }),
      })
    }
    setSubmitting(false)
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-background border rounded-lg p-6 w-full max-w-lg max-h-[85vh] overflow-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">
            {step === "select" && "Add Instance — Select"}
            {step === "validate" && "Add Instance — Validate"}
            {step === "credentials" && "Add Instance — Credentials"}
            {step === "databases" && "Add Instance — Databases"}
          </h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">✕</button>
        </div>

        {/* STEP: Select PG Instance */}
        {step === "select" && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Select a Postgres instance from this account:</p>
            {loading ? <div className="text-sm text-muted-foreground animate-pulse">Loading instances...</div> : (
              <div className="space-y-1 max-h-[300px] overflow-auto">
                {pgInstances.filter(i => i.state === "READY").map(inst => (
                  <label key={inst.name} className={`flex items-center gap-3 p-3 rounded border cursor-pointer ${selectedInstance === inst.name ? "border-primary bg-primary/5" : "hover:border-primary/50"}`}>
                    <input type="radio" name="pg_instance" checked={selectedInstance === inst.name} onChange={() => { setSelectedInstance(inst.name); setSelectedHost(inst.host) }} />
                    <div>
                      <div className="font-medium text-sm">{inst.name}</div>
                      <div className="text-xs text-muted-foreground font-mono">{inst.host}</div>
                    </div>
                  </label>
                ))}
                {pgInstances.filter(i => i.state !== "READY").length > 0 && (
                  <div className="text-xs text-muted-foreground mt-2">
                    {pgInstances.filter(i => i.state !== "READY").map(i => `${i.name} (${i.state})`).join(", ")} — not ready
                  </div>
                )}
              </div>
            )}
            <div className="flex justify-end pt-2 border-t">
              <button onClick={() => { setStep("validate"); validate() }} disabled={!selectedInstance} className="btn-primary">Validate →</button>
            </div>
          </div>
        )}

        {/* STEP: Validate */}
        {step === "validate" && (
          <div className="space-y-4">
            {validating ? (
              <div className="flex items-center gap-2 text-sm"><Loader2 size={14} className="animate-spin" /> Checking network configuration...</div>
            ) : (
              <>
                <div className="space-y-2">
                  {checks.map((c, i) => (
                    <div key={i} className={`flex items-start gap-2 p-2 rounded text-sm ${c.ok ? "bg-green-50 dark:bg-green-950" : "bg-red-50 dark:bg-red-950"}`}>
                      {c.ok ? <CheckCircle size={14} className="mt-0.5 text-green-600 shrink-0" /> : <XCircle size={14} className="mt-0.5 text-red-500 shrink-0" />}
                      <div><strong>{c.name}:</strong> {c.message}</div>
                    </div>
                  ))}
                </div>

                {!passed && commands.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-red-700 dark:text-red-300">Run these commands as ACCOUNTADMIN to fix:</span>
                      <button onClick={() => navigator.clipboard.writeText(commands.join("\n"))} className="text-xs flex items-center gap-1 text-primary hover:underline">
                        <Copy size={10} /> Copy
                      </button>
                    </div>
                    <pre className="text-xs bg-muted p-3 rounded overflow-auto max-h-[200px] font-mono whitespace-pre-wrap">{commands.join("\n")}</pre>
                  </div>
                )}

                <div className="flex justify-between pt-2 border-t">
                  <button onClick={() => setStep("select")} className="btn-secondary">← Back</button>
                  {!passed ? (
                    <button onClick={validate} className="btn-secondary">Re-validate</button>
                  ) : (
                    <button onClick={() => setStep("credentials")} className="btn-primary">Next: Credentials →</button>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* STEP: Credentials */}
        {step === "credentials" && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Enter credentials for <strong>{selectedInstance}</strong>:</p>
            <label className="block">
              <span className="text-xs font-medium">Username</span>
              <input value={username} onChange={e => setUsername(e.target.value)} className="input" />
            </label>
            <label className="block">
              <span className="text-xs font-medium">Password</span>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="input" placeholder="From ALTER POSTGRES INSTANCE ... RESET ACCESS" />
            </label>
            {error && <div className="text-xs text-red-600 bg-red-50 dark:bg-red-950 rounded p-2">{error}</div>}
            <div className="flex justify-between pt-2 border-t">
              <button onClick={() => setStep("validate")} className="btn-secondary">← Back</button>
              <button onClick={fetchDatabases} disabled={loadingDbs || !password} className="btn-primary">
                {loadingDbs ? "Connecting..." : "Connect & Select Databases →"}
              </button>
            </div>
          </div>
        )}

        {/* STEP: Select Databases */}
        {step === "databases" && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Select databases to sync from <strong>{selectedInstance}</strong>:</p>
            <div className="border rounded max-h-[200px] overflow-auto">
              {databases.map(db => (
                <label key={db} className="flex items-center gap-2 px-3 py-2 hover:bg-muted/30 cursor-pointer border-b last:border-b-0">
                  <input type="checkbox" checked={selectedDbs.has(db)} onChange={() => {
                    const next = new Set(selectedDbs)
                    next.has(db) ? next.delete(db) : next.add(db)
                    setSelectedDbs(next)
                  }} className="rounded" />
                  <span className="font-mono text-sm">{db}</span>
                </label>
              ))}
            </div>
            {error && <div className="text-xs text-red-600 bg-red-50 dark:bg-red-950 rounded p-2">{error}</div>}
            <div className="flex justify-between pt-2 border-t">
              <button onClick={() => setStep("credentials")} className="btn-secondary">← Back</button>
              <button onClick={addSelectedDatabases} disabled={submitting || selectedDbs.size === 0} className="btn-primary">
                {submitting ? "Adding..." : `Add ${selectedDbs.size} Database${selectedDbs.size !== 1 ? "s" : ""}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
