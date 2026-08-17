"use client"

import { useState, useEffect } from "react"
import { GitBranch, Play, Plus, Trash2, Search } from "lucide-react"

export default function RoleSyncPage() {
  const [configs, setConfigs] = useState<any[]>([])
  const [instances, setInstances] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<any>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [precheckResult, setPrecheckResult] = useState<any>(null)
  const [precheckRole, setPrecheckRole] = useState("")
  const [prechecking, setPrechecking] = useState(false)

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    const res = await fetch("/api/config")
    const data = await res.json()
    setConfigs(data.roleConfigs || [])
    setInstances(data.instances || [])
    setLoading(false)
  }

  async function triggerSync(instanceId: number) {
    setSyncing(true)
    setSyncResult(null)
    const res = await fetch("/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "roles", instance_id: instanceId }),
    })
    const data = await res.json()
    setSyncResult(data.result)
    setSyncing(false)
  }

  async function runPrecheck() {
    if (!precheckRole) return
    setPrechecking(true)
    setPrecheckResult(null)
    const res = await fetch("/api/precheck", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role_name: precheckRole, instance_id: 1 }),
    })
    const data = await res.json()
    setPrecheckResult(data.result)
    setPrechecking(false)
  }

  async function deleteConfig(configId: number) {
    await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete_role_sync", config_id: configId }),
    })
    loadData()
  }

  if (loading) return <div className="text-sm text-muted-foreground">Loading...</div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Role Sync</h1>
          <p className="text-sm text-muted-foreground mt-1">Sync Snowflake roles and their grants to Postgres</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => triggerSync(1)} disabled={syncing} className="btn-secondary">
            <Play size={14} className={syncing ? "animate-pulse" : ""} />
            Sync All Roles
          </button>
          <button onClick={() => setShowAdd(true)} className="btn-primary">
            <Plus size={14} /> Add Role
          </button>
        </div>
      </div>

      {syncResult && (
        <div className={`p-3 rounded-md text-sm border ${syncResult.status === "SUCCESS" ? "bg-green-50 border-green-200 dark:bg-green-950 dark:border-green-800" : "bg-yellow-50 border-yellow-200 dark:bg-yellow-950 dark:border-yellow-800"}`}>
          <strong>{syncResult.status}</strong> — {syncResult.duration_seconds}s
          {syncResult.results?.map((r: any, i: number) => (
            <div key={i} className="text-xs mt-1">
              {r.action}: {r.role} — {r.status}
              {r.grants_applied !== undefined && <> ({r.grants_applied} applied, {r.grants_skipped} skipped)</>}
            </div>
          ))}
        </div>
      )}

      <div className="border rounded-md overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left p-2 font-medium">Snowflake Role</th>
              <th className="text-left p-2 font-medium">PG Role</th>
              <th className="text-left p-2 font-medium">Sync Grants</th>
              <th className="text-left p-2 font-medium">Enabled</th>
              <th className="text-left p-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {configs.map((cfg: any) => (
              <tr key={cfg.CONFIG_ID} className="border-t">
                <td className="p-2 font-mono text-xs">{cfg.SNOWFLAKE_ROLE}</td>
                <td className="p-2 font-mono text-xs">{cfg.PG_ROLE}</td>
                <td className="p-2">{cfg.SYNC_GRANTS ? "Yes" : "No"}</td>
                <td className="p-2">{cfg.ENABLED ? "✓" : "✗"}</td>
                <td className="p-2">
                  <button onClick={() => deleteConfig(cfg.CONFIG_ID)} className="p-1 rounded hover:bg-muted text-red-500" title="Delete">
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
            {configs.length === 0 && (
              <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">No role syncs configured.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="border rounded-lg p-4 space-y-3">
        <h2 className="text-lg font-semibold">Role Pre-Check</h2>
        <p className="text-sm text-muted-foreground">Check what a Snowflake role's grants look like in Postgres before syncing.</p>
        <div className="flex gap-2">
          <input value={precheckRole} onChange={(e) => setPrecheckRole(e.target.value.toUpperCase())} placeholder="Enter Snowflake role name" className="input flex-1" />
          <button onClick={runPrecheck} disabled={prechecking || !precheckRole} className="btn-primary">
            <Search size={14} />
            {prechecking ? "Checking..." : "Pre-Check"}
          </button>
        </div>

        {precheckResult && (
          <div className="mt-3 space-y-2">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="bg-green-50 dark:bg-green-950 rounded p-2">
                <div className="text-lg font-bold text-green-700 dark:text-green-300">{precheckResult.summary?.syncable || 0}</div>
                <div className="text-xs text-muted-foreground">Syncable</div>
              </div>
              <div className="bg-yellow-50 dark:bg-yellow-950 rounded p-2">
                <div className="text-lg font-bold text-yellow-700 dark:text-yellow-300">{precheckResult.summary?.missing_objects || 0}</div>
                <div className="text-xs text-muted-foreground">Missing in PG</div>
              </div>
              <div className="bg-gray-50 dark:bg-gray-900 rounded p-2">
                <div className="text-lg font-bold">{precheckResult.summary?.not_applicable || 0}</div>
                <div className="text-xs text-muted-foreground">Not Applicable</div>
              </div>
            </div>

            {precheckResult.syncable_grants?.length > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer font-medium text-green-700 dark:text-green-300">Syncable Grants ({precheckResult.syncable_grants.length})</summary>
                <ul className="mt-1 space-y-0.5 pl-4">
                  {precheckResult.syncable_grants.slice(0, 20).map((g: any, i: number) => (
                    <li key={i}>{g.pg_privilege} on {g.pg_target}</li>
                  ))}
                </ul>
              </details>
            )}

            {precheckResult.missing_objects?.length > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer font-medium text-yellow-700 dark:text-yellow-300">Missing Objects ({precheckResult.missing_objects.length})</summary>
                <ul className="mt-1 space-y-0.5 pl-4">
                  {precheckResult.missing_objects.slice(0, 20).map((g: any, i: number) => (
                    <li key={i}>{g.pg_target} — {g.action_needed}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </div>

      {showAdd && <AddRoleModal onClose={() => setShowAdd(false)} onAdded={loadData} />}
    </div>
  )
}

function AddRoleModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [form, setForm] = useState({ snowflake_role: "", pg_role: "", sync_grants: true, instance_id: 1 })
  const [submitting, setSubmitting] = useState(false)
  const [sfRoles, setSfRoles] = useState<any[]>([])
  const [loadingRoles, setLoadingRoles] = useState(true)
  const [precheck, setPrecheck] = useState<any>(null)
  const [prechecking, setPrechecking] = useState(false)

  useEffect(() => {
    fetch("/api/browse?level=roles")
      .then(r => r.json())
      .then(data => { setSfRoles(data); setLoadingRoles(false) })
      .catch(() => setLoadingRoles(false))
  }, [])

  async function handleRoleSelect(roleName: string) {
    setForm({ ...form, snowflake_role: roleName, pg_role: roleName.toLowerCase() })
    setPrecheck(null)
    if (roleName) {
      setPrechecking(true)
      const res = await fetch("/api/precheck", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role_name: roleName, instance_id: 1 }),
      })
      const data = await res.json()
      setPrecheck(data.result)
      setPrechecking(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "add_role_sync", ...form }),
    })
    setSubmitting(false)
    onAdded()
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-background border rounded-lg p-6 w-full max-w-lg">
        <h2 className="text-lg font-semibold mb-4">Sync Snowflake Role to Postgres</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <label className="block">
            <span className="text-xs font-medium">Snowflake Role</span>
            {loadingRoles ? (
              <div className="text-xs text-muted-foreground py-2">Loading roles...</div>
            ) : (
              <select value={form.snowflake_role} onChange={(e) => handleRoleSelect(e.target.value)} className="input">
                <option value="">Select a Snowflake role...</option>
                {sfRoles.map((r: any) => (
                  <option key={r.name} value={r.name}>{r.name}</option>
                ))}
              </select>
            )}
          </label>
          <label className="block">
            <span className="text-xs font-medium">PG Role Name</span>
            <input value={form.pg_role} onChange={(e) => setForm({ ...form, pg_role: e.target.value })} className="input" placeholder="auto-generated from SF role" />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.sync_grants} onChange={(e) => setForm({ ...form, sync_grants: e.target.checked })} />
            Sync grants (replicate accessible table/schema permissions)
          </label>

          {prechecking && <div className="text-xs text-muted-foreground animate-pulse p-2">Running pre-check...</div>}
          {precheck && (
            <div className="border rounded-md p-3 space-y-2">
              <span className="text-xs font-medium">Pre-Check Results</span>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-green-50 dark:bg-green-950 rounded p-1.5">
                  <div className="text-sm font-bold text-green-700 dark:text-green-300">{precheck.summary?.syncable || 0}</div>
                  <div className="text-xs text-muted-foreground">Syncable</div>
                </div>
                <div className="bg-yellow-50 dark:bg-yellow-950 rounded p-1.5">
                  <div className="text-sm font-bold text-yellow-700 dark:text-yellow-300">{precheck.summary?.missing_objects || 0}</div>
                  <div className="text-xs text-muted-foreground">Missing in PG</div>
                </div>
                <div className="bg-gray-50 dark:bg-gray-900 rounded p-1.5">
                  <div className="text-sm font-bold">{precheck.summary?.not_applicable || 0}</div>
                  <div className="text-xs text-muted-foreground">N/A</div>
                </div>
              </div>
              {precheck.missing_objects?.length > 0 && (
                <div className="text-xs text-yellow-600 mt-1">
                  {precheck.missing_objects.length} objects need to be synced to PG first for full grant replication.
                </div>
              )}
            </div>
          )}

          <div className="flex gap-2 justify-end pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={submitting || !form.snowflake_role} className="btn-primary">{submitting ? "Adding..." : "Add Role Sync"}</button>
          </div>
        </form>
      </div>
    </div>
  )
}
