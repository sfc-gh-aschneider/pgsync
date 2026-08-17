"use client"

import { useState, useEffect, useCallback } from "react"
import { useInstance } from "@/components/instance-provider"
import { Plus, Trash2, RefreshCw, CheckCircle, XCircle, AlertTriangle, Network, Loader2 } from "lucide-react"

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

interface NetworkStatus {
  instance_id: number
  has_network_rule: boolean
  has_eai: boolean
  rule_includes_host: boolean
  message: string
}

export default function AdminPage() {
  const { instances, refresh } = useInstance()
  const [networkStatuses, setNetworkStatuses] = useState<Record<number, NetworkStatus>>({})
  const [checking, setChecking] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)
  const [applyingRule, setApplyingRule] = useState<number | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [newInstance, setNewInstance] = useState({
    name: "",
    host: "",
    port: "5432",
    database: "postgres",
    service_user: "bridge_svc",
    secret_name: "PGSYNC_DB.METADATA.PG_SECRET",
  })
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null)

  const checkNetworkStatus = useCallback(async (instance: Instance) => {
    setChecking(instance.INSTANCE_ID)
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "check_network", instance_id: instance.INSTANCE_ID }),
      })
      const data = await res.json()
      if (data.status) {
        setNetworkStatuses(prev => ({ ...prev, [instance.INSTANCE_ID]: data.status }))
      }
    } catch (e) {
      console.error(e)
    } finally {
      setChecking(null)
    }
  }, [])

  const applyNetworkRule = async (instance: Instance) => {
    setApplyingRule(instance.INSTANCE_ID)
    setFeedback(null)
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "apply_network_rule", instance_id: instance.INSTANCE_ID }),
      })
      const data = await res.json()
      if (data.success) {
        setFeedback({ type: "success", message: `Network rule updated for ${instance.INSTANCE_NAME}` })
        checkNetworkStatus(instance)
        refresh()
      } else {
        setFeedback({ type: "error", message: data.error || "Failed to apply network rule" })
      }
    } catch (e: any) {
      setFeedback({ type: "error", message: e.message })
    } finally {
      setApplyingRule(null)
    }
  }

  const addInstance = async () => {
    setAdding(true)
    setFeedback(null)
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add_instance", ...newInstance }),
      })
      const data = await res.json()
      if (data.success) {
        setFeedback({ type: "success", message: `Instance "${newInstance.name}" added successfully` })
        setShowAddForm(false)
        setNewInstance({ name: "", host: "", port: "5432", database: "postgres", service_user: "bridge_svc", secret_name: "PGSYNC_DB.METADATA.PG_SECRET" })
        refresh()
      } else {
        setFeedback({ type: "error", message: data.error || "Failed to add instance" })
      }
    } catch (e: any) {
      setFeedback({ type: "error", message: e.message })
    } finally {
      setAdding(false)
    }
  }

  const removeInstance = async (id: number, name: string) => {
    if (!confirm(`Remove instance "${name}"? This will not delete any synced data.`)) return
    setFeedback(null)
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "remove_instance", instance_id: id }),
      })
      const data = await res.json()
      if (data.success) {
        setFeedback({ type: "success", message: `Instance "${name}" removed` })
        refresh()
      } else {
        setFeedback({ type: "error", message: data.error || "Failed to remove" })
      }
    } catch (e: any) {
      setFeedback({ type: "error", message: e.message })
    }
  }

  const toggleInstance = async (id: number, enabled: boolean) => {
    try {
      await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "toggle_instance", instance_id: id, enabled }),
      })
      refresh()
    } catch (e) {
      console.error(e)
    }
  }

  useEffect(() => {
    instances.forEach(inst => {
      if (!networkStatuses[inst.INSTANCE_ID]) {
        checkNetworkStatus(inst)
      }
    })
  }, [instances, checkNetworkStatus, networkStatuses])

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Admin</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage Postgres instances and network access
          </p>
        </div>
        <button
          onClick={() => setShowAddForm(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 text-sm font-medium"
        >
          <Plus size={16} /> Add Instance
        </button>
      </div>

      {feedback && (
        <div className={`p-3 rounded-md text-sm flex items-center gap-2 ${
          feedback.type === "success" ? "bg-green-500/10 text-green-600 border border-green-500/20" : "bg-red-500/10 text-red-600 border border-red-500/20"
        }`}>
          {feedback.type === "success" ? <CheckCircle size={16} /> : <XCircle size={16} />}
          {feedback.message}
        </div>
      )}

      {/* Add Instance Form */}
      {showAddForm && (
        <div className="border border-border rounded-lg p-4 bg-muted/30 space-y-3">
          <h3 className="font-medium text-sm">New Postgres Instance</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Instance Name</label>
              <input
                value={newInstance.name}
                onChange={e => setNewInstance(p => ({ ...p, name: e.target.value }))}
                placeholder="e.g. PROD_PG"
                className="w-full mt-1 px-3 py-1.5 bg-background border border-border rounded text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Host (from SHOW POSTGRES INSTANCES)</label>
              <input
                value={newInstance.host}
                onChange={e => setNewInstance(p => ({ ...p, host: e.target.value }))}
                placeholder="xxxxx.sfseapac-ant....postgres.snowflake.app"
                className="w-full mt-1 px-3 py-1.5 bg-background border border-border rounded text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Port</label>
              <input
                value={newInstance.port}
                onChange={e => setNewInstance(p => ({ ...p, port: e.target.value }))}
                className="w-full mt-1 px-3 py-1.5 bg-background border border-border rounded text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Database</label>
              <input
                value={newInstance.database}
                onChange={e => setNewInstance(p => ({ ...p, database: e.target.value }))}
                className="w-full mt-1 px-3 py-1.5 bg-background border border-border rounded text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Service User</label>
              <input
                value={newInstance.service_user}
                onChange={e => setNewInstance(p => ({ ...p, service_user: e.target.value }))}
                className="w-full mt-1 px-3 py-1.5 bg-background border border-border rounded text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Secret (fully qualified)</label>
              <input
                value={newInstance.secret_name}
                onChange={e => setNewInstance(p => ({ ...p, secret_name: e.target.value }))}
                className="w-full mt-1 px-3 py-1.5 bg-background border border-border rounded text-sm"
              />
            </div>
          </div>
          <div className="flex gap-2 pt-2">
            <button
              onClick={addInstance}
              disabled={adding || !newInstance.name || !newInstance.host}
              className="px-4 py-1.5 bg-primary text-primary-foreground rounded text-sm font-medium disabled:opacity-50 flex items-center gap-2"
            >
              {adding && <Loader2 size={14} className="animate-spin" />}
              Add Instance
            </button>
            <button
              onClick={() => setShowAddForm(false)}
              className="px-4 py-1.5 border border-border rounded text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Instance Cards */}
      <div className="space-y-4">
        {instances.map((inst) => {
          const status = networkStatuses[inst.INSTANCE_ID]
          const isHealthy = status?.has_network_rule && status?.has_eai && status?.rule_includes_host

          return (
            <div key={inst.INSTANCE_ID} className="border border-border rounded-lg p-4 bg-card">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-2.5 h-2.5 rounded-full ${inst.ENABLED ? "bg-green-500" : "bg-gray-400"}`} />
                  <div>
                    <h3 className="font-semibold text-sm">{inst.INSTANCE_NAME}</h3>
                    <p className="text-xs text-muted-foreground font-mono mt-0.5">
                      {inst.PG_HOST}:{inst.PG_PORT}/{inst.PG_DATABASE}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1.5 text-xs">
                    <input
                      type="checkbox"
                      checked={inst.ENABLED}
                      onChange={e => toggleInstance(inst.INSTANCE_ID, e.target.checked)}
                      className="rounded"
                    />
                    Enabled
                  </label>
                  <button
                    onClick={() => removeInstance(inst.INSTANCE_ID, inst.INSTANCE_NAME)}
                    className="p-1.5 text-muted-foreground hover:text-red-500 rounded"
                    title="Remove instance"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              {/* Network Status */}
              <div className="mt-3 pt-3 border-t border-border">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs">
                    <Network size={14} className="text-muted-foreground" />
                    <span className="text-muted-foreground font-medium">Network Access:</span>
                    {checking === inst.INSTANCE_ID ? (
                      <span className="flex items-center gap-1 text-muted-foreground">
                        <Loader2 size={12} className="animate-spin" /> Checking...
                      </span>
                    ) : status ? (
                      isHealthy ? (
                        <span className="flex items-center gap-1 text-green-600">
                          <CheckCircle size={12} /> Configured
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-amber-600">
                          <AlertTriangle size={12} /> {status.message}
                        </span>
                      )
                    ) : (
                      <span className="text-muted-foreground">Unknown</span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => checkNetworkStatus(inst)}
                      disabled={checking === inst.INSTANCE_ID}
                      className="text-xs flex items-center gap-1 px-2 py-1 border border-border rounded hover:bg-muted"
                    >
                      <RefreshCw size={12} /> Re-check
                    </button>
                    {status && !isHealthy && (
                      <button
                        onClick={() => applyNetworkRule(inst)}
                        disabled={applyingRule === inst.INSTANCE_ID}
                        className="text-xs flex items-center gap-1 px-2 py-1 bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
                      >
                        {applyingRule === inst.INSTANCE_ID ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <Network size={12} />
                        )}
                        Auto-fix Network Rule
                      </button>
                    )}
                  </div>
                </div>

                {/* Details row */}
                {status && (
                  <div className="mt-2 flex gap-4 text-xs text-muted-foreground">
                    <span className={status.has_network_rule ? "text-green-600" : "text-red-500"}>
                      {status.has_network_rule ? "✓" : "✗"} Network Rule
                    </span>
                    <span className={status.has_eai ? "text-green-600" : "text-red-500"}>
                      {status.has_eai ? "✓" : "✗"} EAI
                    </span>
                    <span className={status.rule_includes_host ? "text-green-600" : "text-red-500"}>
                      {status.rule_includes_host ? "✓" : "✗"} Host in Rule
                    </span>
                  </div>
                )}
              </div>

              {/* Instance metadata */}
              <div className="mt-3 pt-3 border-t border-border grid grid-cols-3 gap-3 text-xs text-muted-foreground">
                <div>
                  <span className="font-medium">Service User:</span> {inst.PG_SERVICE_USER}
                </div>
                <div>
                  <span className="font-medium">Secret:</span> {inst.SECRET_NAME}
                </div>
                <div>
                  <span className="font-medium">EAI:</span> {inst.EAI_NAME || "PGSYNC_PG_EAI"}
                </div>
              </div>
            </div>
          )
        })}

        {instances.length === 0 && (
          <div className="text-center py-12 text-muted-foreground text-sm">
            No Postgres instances configured. Click &quot;Add Instance&quot; to get started.
          </div>
        )}
      </div>

      {/* Standardized Rule Info */}
      <div className="border border-border rounded-lg p-4 bg-muted/20">
        <h3 className="font-medium text-sm mb-2">Network Rule Standard</h3>
        <p className="text-xs text-muted-foreground mb-2">
          All PG instances share a single network rule (<code className="bg-muted px-1 rounded">PGSYNC_DB.METADATA.PGSYNC_NETWORK_RULE</code>) and EAI (<code className="bg-muted px-1 rounded">PGSYNC_PG_EAI</code>). 
          When you add a new instance, the app automatically adds its host:port to the network rule&apos;s VALUE_LIST.
        </p>
        <p className="text-xs text-muted-foreground">
          This ensures stored procedures can reach all registered PG instances without manual DDL.
        </p>
      </div>
    </div>
  )
}
