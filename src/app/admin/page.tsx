"use client"

import { useState, useEffect, useCallback } from "react"
import { useInstance } from "@/components/instance-provider"
import { Plus, Trash2, CheckCircle, XCircle, AlertTriangle, Loader2, Plug } from "lucide-react"

interface Instance {
  INSTANCE_ID: number
  INSTANCE_NAME: string
  PG_HOST: string
  PG_PORT: number
  PG_DATABASE: string
  PG_SERVICE_USER: string
  SECRET_NAME: string
  NETWORK_RULE_NAME: string | null
  EAI_NAME: string | null
  ENABLED: boolean
  NOTES: string | null
}

export default function AdminPage() {
  const { instances, refresh } = useInstance()
  const [showAddForm, setShowAddForm] = useState(false)
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null)
  const [testResults, setTestResults] = useState<Record<number, { status: string; message: string }>>({})
  const [testing, setTesting] = useState<number | null>(null)

  async function testConnection(instance: Instance) {
    setTesting(instance.INSTANCE_ID)
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test_connection", instance_id: instance.INSTANCE_ID }),
      })
      const data = await res.json()
      if (data.status === "connected") {
        setTestResults(prev => ({ ...prev, [instance.INSTANCE_ID]: { status: "ok", message: `Connected as ${data.user} to ${data.db}` } }))
      } else if (data.status === "network_error") {
        setTestResults(prev => ({ ...prev, [instance.INSTANCE_ID]: { status: "network", message: data.error } }))
      } else if (data.status === "auth_error") {
        setTestResults(prev => ({ ...prev, [instance.INSTANCE_ID]: { status: "auth", message: data.error } }))
      } else {
        setTestResults(prev => ({ ...prev, [instance.INSTANCE_ID]: { status: "error", message: data.error || "Unknown error" } }))
      }
    } catch (e: any) {
      setTestResults(prev => ({ ...prev, [instance.INSTANCE_ID]: { status: "error", message: e.message } }))
    }
    setTesting(null)
  }

  async function removeInstance(id: number) {
    const res = await fetch("/api/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "remove_instance", instance_id: id }),
    })
    const data = await res.json()
    if (data.error) setFeedback({ type: "error", message: data.error })
    else { setFeedback({ type: "success", message: "Instance removed" }); refresh() }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Admin</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage Postgres instances and connectivity</p>
        </div>
        <button onClick={() => setShowAddForm(true)} className="btn-primary">
          <Plus size={14} /> Add Instance
        </button>
      </div>

      {feedback && (
        <div className={`p-3 rounded-md text-sm border ${feedback.type === "success" ? "bg-green-50 border-green-200 dark:bg-green-950 dark:border-green-800" : "bg-red-50 border-red-200 dark:bg-red-950 dark:border-red-800"}`}>
          {feedback.message}
          <button onClick={() => setFeedback(null)} className="ml-2 text-xs underline">dismiss</button>
        </div>
      )}

      <div className="space-y-3">
        {(instances as Instance[]).map((inst) => {
          const result = testResults[inst.INSTANCE_ID]
          return (
            <div key={inst.INSTANCE_ID} className="border rounded-md p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold">{inst.INSTANCE_NAME}</h3>
                  <p className="text-xs font-mono text-muted-foreground mt-0.5">{inst.PG_HOST}</p>
                  <p className="text-xs text-muted-foreground">Database: {inst.PG_DATABASE} | User: {inst.PG_SERVICE_USER}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => testConnection(inst)} disabled={testing === inst.INSTANCE_ID} className="btn-secondary text-xs px-3 py-1.5">
                    {testing === inst.INSTANCE_ID ? <Loader2 size={12} className="animate-spin" /> : <Plug size={12} />}
                    Test Connection
                  </button>
                  <button onClick={() => removeInstance(inst.INSTANCE_ID)} className="p-1.5 rounded hover:bg-muted text-red-500" title="Remove">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              {result && (
                <div className={`mt-3 p-2 rounded text-xs flex items-start gap-2 ${result.status === "ok" ? "bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200" : "bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200"}`}>
                  {result.status === "ok" ? <CheckCircle size={14} className="mt-0.5 shrink-0" /> : result.status === "network" ? <AlertTriangle size={14} className="mt-0.5 shrink-0" /> : <XCircle size={14} className="mt-0.5 shrink-0" />}
                  <span>{result.message}</span>
                </div>
              )}
            </div>
          )
        })}

        {instances.length === 0 && (
          <div className="border rounded-md p-8 text-center text-muted-foreground text-sm">
            No Postgres instances configured. Add one to get started.
          </div>
        )}
      </div>

      {showAddForm && <AddInstanceModal onClose={() => setShowAddForm(false)} onAdded={() => { refresh(); setShowAddForm(false); setFeedback({ type: "success", message: "Instance added and procedures rebuilt." }) }} />}
    </div>
  )
}

function AddInstanceModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [form, setForm] = useState({
    name: "",
    host: "",
    port: "5432",
    database: "postgres",
    service_user: "snowflake_admin",
    password: "",
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name || !form.host || !form.password) {
      setError("Name, host, and password are required")
      return
    }
    setSubmitting(true)
    setError("")
    const res = await fetch("/api/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "add_instance", ...form, port: Number(form.port) }),
    })
    const data = await res.json()
    setSubmitting(false)
    if (data.error) {
      setError(data.error)
    } else {
      onAdded()
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-background border rounded-lg p-6 w-full max-w-md">
        <h2 className="text-lg font-semibold mb-4">Add Postgres Instance</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <label className="block">
            <span className="text-xs font-medium">Instance Name</span>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_") })} className="input" placeholder="MY_PG" />
          </label>
          <label className="block">
            <span className="text-xs font-medium">Host</span>
            <input value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} className="input font-mono text-xs" placeholder="abc123.account.region.aws.postgres.snowflake.app" />
            <span className="text-xs text-muted-foreground">From: DESCRIBE POSTGRES INSTANCE name</span>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium">Port</span>
              <input value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} className="input" />
            </label>
            <label className="block">
              <span className="text-xs font-medium">Database</span>
              <input value={form.database} onChange={(e) => setForm({ ...form, database: e.target.value })} className="input" />
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-medium">Username</span>
            <input value={form.service_user} onChange={(e) => setForm({ ...form, service_user: e.target.value })} className="input" />
          </label>
          <label className="block">
            <span className="text-xs font-medium">Password</span>
            <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="input" placeholder="From: ALTER POSTGRES INSTANCE ... RESET ACCESS" />
          </label>

          {error && <div className="text-xs text-red-600 bg-red-50 dark:bg-red-950 rounded p-2">{error}</div>}

          <div className="flex gap-2 justify-end pt-2 border-t">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={submitting} className="btn-primary">
              {submitting ? "Adding & Rebuilding..." : "Add Instance"}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
