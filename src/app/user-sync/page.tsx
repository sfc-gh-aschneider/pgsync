"use client"

import { useState, useEffect } from "react"
import { Users, Play, Plus, Trash2, Shield, Monitor } from "lucide-react"

interface UserConfig {
  CONFIG_ID: number
  INSTANCE_ID: number
  SNOWFLAKE_USER: string
  PG_USER: string
  AUTH_MODE: string
  PG_PASSWORD: string | null
  ROLES: any
  ENABLED: boolean
}

export default function UserSyncPage() {
  const [configs, setConfigs] = useState<UserConfig[]>([])
  const [instances, setInstances] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<any>(null)
  const [showAdd, setShowAdd] = useState<"app" | "user" | null>(null)
  const [selectedInstance, setSelectedInstance] = useState<number>(0)

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    const res = await fetch("/api/config")
    const data = await res.json()
    setConfigs(data.userConfigs || [])
    const insts = data.instances || []
    setInstances(insts)
    if (insts.length > 0 && !selectedInstance) setSelectedInstance(insts[0].INSTANCE_ID)
    setLoading(false)
  }

  async function triggerSync() {
    if (!selectedInstance) return
    setSyncing(true)
    setSyncResult(null)
    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "users", instance_id: selectedInstance }),
      })
      const data = await res.json()
      setSyncResult(data.error ? { status: "FAILED", error: data.error } : (data.result || { status: "SUCCESS" }))
    } catch (e: any) {
      setSyncResult({ status: "FAILED", error: e.message })
    }
    setSyncing(false)
  }

  async function deleteConfig(configId: number) {
    await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete_user_sync", config_id: configId }),
    })
    loadData()
  }

  function parseRoles(roles: any): string {
    if (!roles) return "-"
    if (Array.isArray(roles)) return roles.join(", ")
    try { return JSON.parse(roles).join(", ") } catch { return String(roles) }
  }

  if (loading) return <div className="text-sm text-muted-foreground">Loading...</div>

  const filteredConfigs = configs.filter(c => c.INSTANCE_ID === selectedInstance)
  const appAccounts = filteredConfigs.filter(c => c.AUTH_MODE === "PASSWORD")
  const userAccounts = filteredConfigs.filter(c => c.AUTH_MODE !== "PASSWORD")

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">User Sync</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage Postgres users for applications and individuals</p>
        </div>
        <div className="flex gap-2">
          <button onClick={triggerSync} disabled={syncing || !selectedInstance} className="btn-secondary">
            <Play size={14} className={syncing ? "animate-pulse" : ""} /> Sync All Users
          </button>
        </div>
      </div>

      <div className="flex gap-3 items-center">
        <label className="text-xs font-medium">PG Instance:</label>
        <select value={selectedInstance} onChange={(e) => setSelectedInstance(Number(e.target.value))} className="input w-auto">
          {instances.map((i: any) => <option key={i.INSTANCE_ID} value={i.INSTANCE_ID}>{i.INSTANCE_NAME} ({i.PG_DATABASE})</option>)}
        </select>
      </div>

      {syncing && (
        <div className="p-4 rounded-md border border-blue-200 bg-blue-50 dark:bg-blue-950 dark:border-blue-800 flex items-center gap-3">
          <Play size={16} className="animate-pulse text-blue-600" />
          <span className="text-sm font-medium">Syncing users to Postgres...</span>
        </div>
      )}

      {syncResult && !syncing && (
        <div className={`p-3 rounded-md text-sm border ${syncResult.status === "SUCCESS" ? "bg-green-50 border-green-200 dark:bg-green-950 dark:border-green-800" : "bg-yellow-50 border-yellow-200 dark:bg-yellow-950 dark:border-yellow-800"}`}>
          <div className="flex justify-between">
            <div>
              <strong>{syncResult.status}</strong>
              {syncResult.duration_seconds && <> — {syncResult.duration_seconds}s</>}
              {syncResult.error && <p className="text-xs text-red-600 mt-1">{syncResult.error}</p>}
              {syncResult.results?.map((r: any, i: number) => (
                <div key={i} className="text-xs mt-0.5">{r.action}: {r.user || r.role} — {r.status}</div>
              ))}
            </div>
            <button onClick={() => setSyncResult(null)} className="text-muted-foreground">✕</button>
          </div>
        </div>
      )}

      {/* App Accounts Section */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Monitor size={16} className="text-muted-foreground" />
            <h2 className="text-sm font-semibold">App Service Accounts</h2>
            <span className="text-xs text-muted-foreground">Password auth — one per application</span>
          </div>
          <button onClick={() => setShowAdd("app")} className="btn-primary text-xs">
            <Plus size={12} /> Add App Account
          </button>
        </div>
        {appAccounts.length === 0 ? (
          <div className="border rounded-md p-4 text-center text-sm text-muted-foreground">No app accounts configured.</div>
        ) : (
          <div className="border rounded-md overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-2 font-medium">PG User</th>
                  <th className="text-left p-2 font-medium">Roles</th>
                  <th className="text-left p-2 font-medium">Auth</th>
                  <th className="text-left p-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {appAccounts.map((cfg) => (
                  <tr key={cfg.CONFIG_ID} className="border-t">
                    <td className="p-2 font-mono text-xs">{cfg.PG_USER}</td>
                    <td className="p-2 text-xs">{parseRoles(cfg.ROLES)}</td>
                    <td className="p-2"><span className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">PASSWORD</span></td>
                    <td className="p-2">
                      <button onClick={() => deleteConfig(cfg.CONFIG_ID)} className="p-1 rounded hover:bg-muted text-red-500"><Trash2 size={14} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* User Accounts Section */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Shield size={16} className="text-muted-foreground" />
            <h2 className="text-sm font-semibold">Individual User Accounts</h2>
            <span className="text-xs text-muted-foreground">Token auth via Snowflake identity — per person</span>
          </div>
          <button onClick={() => setShowAdd("user")} className="btn-primary text-xs">
            <Plus size={12} /> Add User
          </button>
        </div>
        {userAccounts.length === 0 ? (
          <div className="border rounded-md p-4 text-center text-sm text-muted-foreground">No individual users configured.</div>
        ) : (
          <div className="border rounded-md overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-2 font-medium">Snowflake User</th>
                  <th className="text-left p-2 font-medium">PG User</th>
                  <th className="text-left p-2 font-medium">Roles</th>
                  <th className="text-left p-2 font-medium">Auth</th>
                  <th className="text-left p-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {userAccounts.map((cfg) => (
                  <tr key={cfg.CONFIG_ID} className="border-t">
                    <td className="p-2 font-mono text-xs">{cfg.SNOWFLAKE_USER}</td>
                    <td className="p-2 font-mono text-xs">{cfg.PG_USER}</td>
                    <td className="p-2 text-xs">{parseRoles(cfg.ROLES)}</td>
                    <td className="p-2"><span className={`text-xs px-2 py-0.5 rounded ${cfg.AUTH_MODE === "BOTH" ? "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200" : "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"}`}>{cfg.AUTH_MODE}</span></td>
                    <td className="p-2">
                      <button onClick={() => deleteConfig(cfg.CONFIG_ID)} className="p-1 rounded hover:bg-muted text-red-500"><Trash2 size={14} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showAdd && <AddUserModal type={showAdd} onClose={() => setShowAdd(null)} onAdded={loadData} instanceId={selectedInstance} />}
    </div>
  )
}

function AddUserModal({ type, onClose, onAdded, instanceId }: { type: "app" | "user"; onClose: () => void; onAdded: () => void; instanceId: number }) {
  const [form, setForm] = useState({
    snowflake_user: "",
    pg_user: "",
    auth_mode: type === "app" ? "PASSWORD" : "TOKEN",
    pg_password: "",
    roles: [] as string[],
  })
  const [roleInput, setRoleInput] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [sfUsers, setSfUsers] = useState<any[]>([])
  const [loadingSfUsers, setLoadingSfUsers] = useState(false)
  const [pgRoles, setPgRoles] = useState<string[]>([])
  const [loadingPgRoles, setLoadingPgRoles] = useState(false)

  useEffect(() => {
    if (type === "user") {
      setLoadingSfUsers(true)
      fetch("/api/browse?level=users")
        .then(r => r.json())
        .then(data => { setSfUsers(data); setLoadingSfUsers(false) })
        .catch(() => setLoadingSfUsers(false))
    }
    // Load PG roles
    setLoadingPgRoles(true)
    fetch("/api/pg", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instance_id: instanceId, sql: "SELECT rolname FROM pg_roles WHERE rolname NOT LIKE 'pg_%' AND rolname NOT IN ('snowflake_admin', 'snowflake_monitoring') ORDER BY rolname" }),
    })
      .then(r => r.json())
      .then(data => { setPgRoles((data.rows || []).map((r: any) => r.rolname)); setLoadingPgRoles(false) })
      .catch(() => setLoadingPgRoles(false))
  }, [type, instanceId])

  function addRole(role: string) {
    if (role && !form.roles.includes(role)) {
      setForm({ ...form, roles: [...form.roles, role] })
      setRoleInput("")
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "add_user_sync", instance_id: instanceId, ...form }),
    })
    setSubmitting(false)
    onAdded()
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-background border rounded-lg p-6 w-full max-w-md">
        <h2 className="text-lg font-semibold mb-4">{type === "app" ? "Add App Service Account" : "Add User Account"}</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          {type === "user" && (
            <label className="block">
              <span className="text-xs font-medium">Snowflake User</span>
              {loadingSfUsers ? (
                <div className="text-xs text-muted-foreground py-2">Loading Snowflake users...</div>
              ) : (
                <select value={form.snowflake_user} onChange={(e) => {
                  const user = e.target.value
                  setForm({ ...form, snowflake_user: user, pg_user: user.split("@")[0].toLowerCase().replace(/[^a-z0-9]/g, "_") })
                }} className="input">
                  <option value="">Select Snowflake user...</option>
                  {sfUsers.map((u: any) => (
                    <option key={u.name} value={u.name}>{u.name}{u.email ? ` (${u.email})` : ""}</option>
                  ))}
                </select>
              )}
            </label>
          )}
          <label className="block">
            <span className="text-xs font-medium">PG Username</span>
            <input value={form.pg_user} onChange={(e) => setForm({ ...form, pg_user: e.target.value })} className="input" placeholder={type === "app" ? "app_medical" : "bob"} />
          </label>
          {type === "user" && (
            <label className="block">
              <span className="text-xs font-medium">Auth Mode</span>
              <select value={form.auth_mode} onChange={(e) => setForm({ ...form, auth_mode: e.target.value })} className="input">
                <option value="TOKEN">Token (via Snowflake)</option>
                <option value="BOTH">Both (Token + Password fallback)</option>
              </select>
            </label>
          )}
          {(form.auth_mode === "PASSWORD" || form.auth_mode === "BOTH") && (
            <label className="block">
              <span className="text-xs font-medium">Password</span>
              <input type="password" value={form.pg_password} onChange={(e) => setForm({ ...form, pg_password: e.target.value })} className="input" placeholder="Strong password" />
            </label>
          )}
          <div>
            <span className="text-xs font-medium">PG Roles to assign</span>
            {loadingPgRoles ? (
              <div className="text-xs text-muted-foreground py-1">Loading roles from Postgres...</div>
            ) : pgRoles.length > 0 ? (
              <div className="flex gap-1 mt-1">
                <select value="" onChange={(e) => { if (e.target.value) addRole(e.target.value) }} className="input flex-1">
                  <option value="">Select a PG role...</option>
                  {pgRoles.filter(r => !form.roles.includes(r)).map(r => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="flex gap-1 mt-1">
                <input value={roleInput} onChange={(e) => setRoleInput(e.target.value)} className="input flex-1" placeholder="e.g. energy_analyst" onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addRole(roleInput))} />
                <button type="button" onClick={() => addRole(roleInput)} className="btn-secondary text-xs">Add</button>
              </div>
            )}
            {form.roles.length > 0 && (
              <div className="flex gap-1 mt-2 flex-wrap">
                {form.roles.map((r) => (
                  <span key={r} className="px-2 py-0.5 bg-muted rounded text-xs flex items-center gap-1">
                    {r}<button type="button" onClick={() => setForm({ ...form, roles: form.roles.filter(x => x !== r) })} className="text-red-500">x</button>
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={submitting || !form.pg_user} className="btn-primary">{submitting ? "Adding..." : "Add"}</button>
          </div>
        </form>
      </div>
    </div>
  )
}
