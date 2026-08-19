"use client"

import { useState, useEffect } from "react"
import { Shield, Plus, Trash2, Play, Lock, Eye } from "lucide-react"

export default function PoliciesPage() {
  const [policies, setPolicies] = useState<any[]>([])
  const [instances, setInstances] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState<"RLS" | "COLUMN" | null>(null)
  const [applyResult, setApplyResult] = useState<any>(null)
  const [applying, setApplying] = useState(false)
  const [selectedInstance, setSelectedInstance] = useState<number>(0)

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    const res = await fetch("/api/config")
    const data = await res.json()
    setInstances(data.instances || [])
    if (data.instances?.length > 0 && !selectedInstance) setSelectedInstance(data.instances[0].INSTANCE_ID)

    const polRes = await fetch("/api/policies")
    const polData = await polRes.json()
    setPolicies(polData.policies || [])
    setLoading(false)
  }

  async function applyPolicies() {
    if (!selectedInstance) return
    setApplying(true)
    setApplyResult(null)
    const res = await fetch("/api/policies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "apply", instance_id: selectedInstance }),
    })
    const data = await res.json()
    setApplyResult(data.result || data)
    setApplying(false)
    loadData()
  }

  async function deletePolicy(policyId: number) {
    await fetch("/api/policies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", policy_id: policyId }),
    })
    loadData()
  }

  if (loading) return <div className="text-sm text-muted-foreground">Loading...</div>

  const filtered = policies.filter((p: any) => p.INSTANCE_ID === selectedInstance)
  const rlsPolicies = filtered.filter((p: any) => p.POLICY_TYPE === "RLS")
  const columnPolicies = filtered.filter((p: any) => p.POLICY_TYPE === "COLUMN")

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Security Policies</h1>
          <p className="text-sm text-muted-foreground mt-1">Row-Level Security and column restrictions on PG tables</p>
        </div>
        <button onClick={applyPolicies} disabled={applying || filtered.length === 0} className="btn-primary">
          <Play size={14} className={applying ? "animate-pulse" : ""} />
          {applying ? "Applying..." : "Apply All Policies"}
        </button>
      </div>

      <div className="flex gap-3 items-center">
        <label className="text-xs font-medium">PG Instance:</label>
        <select value={selectedInstance} onChange={(e) => setSelectedInstance(Number(e.target.value))} className="input w-auto">
          {instances.map((i: any) => <option key={i.INSTANCE_ID} value={i.INSTANCE_ID}>{i.INSTANCE_NAME} ({i.PG_DATABASE})</option>)}
        </select>
      </div>

      {applying && (
        <div className="p-4 rounded-md border border-blue-200 bg-blue-50 dark:bg-blue-950 dark:border-blue-800 flex items-center gap-3">
          <Play size={16} className="animate-pulse text-blue-600" />
          <span className="text-sm font-medium">Applying policies to Postgres...</span>
        </div>
      )}

      {applyResult && !applying && (
        <div className={`p-3 rounded-md text-sm border ${applyResult.status === "SUCCESS" ? "bg-green-50 border-green-200 dark:bg-green-950 dark:border-green-800" : "bg-yellow-50 border-yellow-200 dark:bg-yellow-950 dark:border-yellow-800"}`}>
          <div className="flex justify-between">
            <div>
              <strong>{applyResult.status}</strong>{applyResult.duration_seconds && <> — {applyResult.duration_seconds}s</>}
              {applyResult.error && <p className="text-xs text-red-600 mt-1">{applyResult.error}</p>}
              {applyResult.results?.map((r: any, i: number) => (
                <div key={i} className="text-xs mt-0.5">{r.name} on {r.table}: {r.status}{r.error && ` — ${r.error}`}</div>
              ))}
            </div>
            <button onClick={() => setApplyResult(null)} className="text-muted-foreground">✕</button>
          </div>
        </div>
      )}

      {/* RLS Section */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Eye size={16} className="text-muted-foreground" />
            <h2 className="text-sm font-semibold">Row-Level Security (RLS)</h2>
            <span className="text-xs text-muted-foreground">Filter which rows each role can see</span>
          </div>
          <button onClick={() => setShowAdd("RLS")} className="btn-primary text-xs">
            <Plus size={12} /> Add RLS Policy
          </button>
        </div>
        {rlsPolicies.length === 0 ? (
          <div className="border rounded-md p-4 text-center text-sm text-muted-foreground">No RLS policies configured.</div>
        ) : (
          <div className="border rounded-md overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-2 font-medium">Name</th>
                  <th className="text-left p-2 font-medium">Table</th>
                  <th className="text-left p-2 font-medium">Definition</th>
                  <th className="text-left p-2 font-medium">Status</th>
                  <th className="text-left p-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rlsPolicies.map((p: any) => {
                  const def = typeof p.POLICY_DEFINITION === "string" ? JSON.parse(p.POLICY_DEFINITION) : (p.POLICY_DEFINITION || {})
                  return (
                    <tr key={p.POLICY_ID} className="border-t">
                      <td className="p-2 font-mono text-xs">{p.POLICY_NAME}</td>
                      <td className="p-2 font-mono text-xs">{p.TARGET_SCHEMA}.{p.TARGET_TABLE}</td>
                      <td className="p-2 text-xs">
                        {def.bypass_roles?.length > 0 && <div>Bypass: {def.bypass_roles.join(", ")}</div>}
                        {def.filter_role && <div>{def.filter_role}: WHERE {def.filter}</div>}
                      </td>
                      <td className="p-2">{p.APPLIED ? <span className="text-xs text-green-600">Applied</span> : <span className="text-xs text-yellow-600">Pending</span>}</td>
                      <td className="p-2">
                        <button onClick={() => deletePolicy(p.POLICY_ID)} className="p-1 rounded hover:bg-muted text-red-500"><Trash2 size={14} /></button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Column Restrictions Section */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Lock size={16} className="text-muted-foreground" />
            <h2 className="text-sm font-semibold">Column Restrictions</h2>
            <span className="text-xs text-muted-foreground">Block specific columns from roles</span>
          </div>
          <button onClick={() => setShowAdd("COLUMN")} className="btn-primary text-xs">
            <Plus size={12} /> Add Column Restriction
          </button>
        </div>
        {columnPolicies.length === 0 ? (
          <div className="border rounded-md p-4 text-center text-sm text-muted-foreground">No column restrictions configured.</div>
        ) : (
          <div className="border rounded-md overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-2 font-medium">Name</th>
                  <th className="text-left p-2 font-medium">Table</th>
                  <th className="text-left p-2 font-medium">Hidden Columns</th>
                  <th className="text-left p-2 font-medium">From Roles</th>
                  <th className="text-left p-2 font-medium">Status</th>
                  <th className="text-left p-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {columnPolicies.map((p: any) => {
                  const def = typeof p.POLICY_DEFINITION === "string" ? JSON.parse(p.POLICY_DEFINITION) : (p.POLICY_DEFINITION || {})
                  return (
                    <tr key={p.POLICY_ID} className="border-t">
                      <td className="p-2 font-mono text-xs">{p.POLICY_NAME}</td>
                      <td className="p-2 font-mono text-xs">{p.TARGET_SCHEMA}.{p.TARGET_TABLE}</td>
                      <td className="p-2 text-xs font-mono">{def.restricted_columns?.join(", ")}</td>
                      <td className="p-2 text-xs">{def.restricted_from_roles?.join(", ")}</td>
                      <td className="p-2">{p.APPLIED ? <span className="text-xs text-green-600">Applied</span> : <span className="text-xs text-yellow-600">Pending</span>}</td>
                      <td className="p-2">
                        <button onClick={() => deletePolicy(p.POLICY_ID)} className="p-1 rounded hover:bg-muted text-red-500"><Trash2 size={14} /></button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showAdd && (
        <AddPolicyModal
          type={showAdd}
          instanceId={selectedInstance}
          onClose={() => setShowAdd(null)}
          onAdded={loadData}
        />
      )}
    </div>
  )
}

function AddPolicyModal({ type, instanceId, onClose, onAdded }: {
  type: "RLS" | "COLUMN", instanceId: number, onClose: () => void, onAdded: () => void
}) {
  const [targetTable, setTargetTable] = useState("")
  const [policyName, setPolicyName] = useState("")
  const [submitting, setSubmitting] = useState(false)

  // PG tables and roles loaded from instance
  const [pgTables, setPgTables] = useState<any[]>([])
  const [pgRoles, setPgRoles] = useState<string[]>([])
  const [pgColumns, setPgColumns] = useState<string[]>([])
  const [loadingTables, setLoadingTables] = useState(true)
  const [loadingCols, setLoadingCols] = useState(false)

  // RLS-specific
  const [bypassRoles, setBypassRoles] = useState<string[]>([])
  const [filterRole, setFilterRole] = useState("")
  const [filterExpr, setFilterExpr] = useState("")

  // Column-specific
  const [restrictedCols, setRestrictedCols] = useState<string[]>([])
  const [restrictedRoles, setRestrictedRoles] = useState<string[]>([])

  useEffect(() => {
    // Fetch tables from PG
    fetch("/api/pg", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instance_id: instanceId, sql: "SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema', 'snowflake_auth', 'snowflake_cdc', 'lake_engine', 'lake_iceberg', 'lake_table', 'cron', '__pg_lake_table_writes') AND table_type = 'BASE TABLE' ORDER BY table_schema, table_name" }),
    }).then(r => r.json()).then(data => { setPgTables(data.rows || []); setLoadingTables(false) }).catch(() => setLoadingTables(false))

    // Fetch roles from PG
    fetch("/api/pg", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instance_id: instanceId, sql: "SELECT rolname FROM pg_roles WHERE rolname NOT LIKE 'pg_%' AND rolname NOT IN ('snowflake_admin', 'snowflake_monitoring') ORDER BY rolname" }),
    }).then(r => r.json()).then(data => { setPgRoles((data.rows || []).map((r: any) => r.rolname)) }).catch(() => {})
  }, [instanceId])

  async function loadColumns(schema: string, table: string) {
    setLoadingCols(true)
    const res = await fetch("/api/pg", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instance_id: instanceId, sql: `SELECT column_name FROM information_schema.columns WHERE table_schema = '${schema}' AND table_name = '${table}' ORDER BY ordinal_position` }),
    })
    const data = await res.json()
    setPgColumns((data.rows || []).map((r: any) => r.column_name))
    setLoadingCols(false)
  }

  function handleTableSelect(fqn: string) {
    setTargetTable(fqn)
    setRestrictedCols([])
    setPgColumns([])
    if (fqn) {
      const [schema, table] = fqn.split(".")
      loadColumns(schema, table)
      if (!policyName) setPolicyName(`${table}_${type.toLowerCase()}_policy`)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    const [schema, table] = targetTable.split(".")

    const definition = type === "RLS"
      ? { bypass_roles: bypassRoles, filter_role: filterRole, filter: filterExpr }
      : { restricted_columns: restrictedCols, restricted_from_roles: restrictedRoles }

    await fetch("/api/policies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "add",
        instance_id: instanceId,
        policy_type: type,
        target_schema: schema,
        target_table: table,
        policy_name: policyName,
        policy_definition: definition,
      }),
    })
    setSubmitting(false)
    onAdded()
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-background border rounded-lg p-6 w-full max-w-lg max-h-[85vh] overflow-auto">
        <h2 className="text-lg font-semibold mb-4">Add {type === "RLS" ? "Row-Level Security Policy" : "Column Restriction"}</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium">Target Table</span>
              {loadingTables ? (
                <div className="text-xs text-muted-foreground py-2">Loading tables...</div>
              ) : (
                <select value={targetTable} onChange={(e) => handleTableSelect(e.target.value)} className="input">
                  <option value="">Select table...</option>
                  {pgTables.map((t: any) => (
                    <option key={`${t.table_schema}.${t.table_name}`} value={`${t.table_schema}.${t.table_name}`}>
                      {t.table_schema}.{t.table_name}
                    </option>
                  ))}
                </select>
              )}
            </label>
            <label className="block">
              <span className="text-xs font-medium">Policy Name</span>
              <input value={policyName} onChange={(e) => setPolicyName(e.target.value.replace(/[^a-z0-9_]/g, "_"))} className="input" placeholder="my_access_policy" />
            </label>
          </div>

          {type === "RLS" && (
            <>
              <div>
                <span className="text-xs font-medium">Bypass Roles (can see ALL rows)</span>
                {pgRoles.length > 0 ? (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {pgRoles.map(r => (
                      <label key={r} className="flex items-center gap-1 text-xs px-2 py-1 border rounded cursor-pointer hover:bg-muted">
                        <input type="checkbox" checked={bypassRoles.includes(r)} onChange={(e) => {
                          setBypassRoles(e.target.checked ? [...bypassRoles, r] : bypassRoles.filter(x => x !== r))
                        }} />
                        {r}
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground mt-1">No PG roles found. Sync a role first.</p>
                )}
              </div>
              <label className="block">
                <span className="text-xs font-medium">Filtered Role (sees only matching rows)</span>
                <select value={filterRole} onChange={(e) => setFilterRole(e.target.value)} className="input">
                  <option value="">Select role to restrict...</option>
                  {pgRoles.filter(r => !bypassRoles.includes(r)).map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-medium">Filter Expression (SQL WHERE clause)</span>
                <input value={filterExpr} onChange={(e) => setFilterExpr(e.target.value)} className="input font-mono text-xs" placeholder="region = 'VIC'" />
                <span className="text-xs text-muted-foreground mt-0.5 block">Only rows where this is TRUE are visible to the filtered role</span>
              </label>
            </>
          )}

          {type === "COLUMN" && (
            <>
              <div>
                <span className="text-xs font-medium">Columns to hide</span>
                {loadingCols ? (
                  <div className="text-xs text-muted-foreground py-1">Loading columns...</div>
                ) : pgColumns.length > 0 ? (
                  <div className="flex flex-wrap gap-1 mt-1 max-h-[120px] overflow-auto">
                    {pgColumns.map(col => (
                      <label key={col} className="flex items-center gap-1 text-xs px-2 py-1 border rounded cursor-pointer hover:bg-muted">
                        <input type="checkbox" checked={restrictedCols.includes(col)} onChange={(e) => {
                          setRestrictedCols(e.target.checked ? [...restrictedCols, col] : restrictedCols.filter(c => c !== col))
                        }} />
                        <span className="font-mono">{col}</span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground mt-1">{targetTable ? "No columns found" : "Select a table first"}</p>
                )}
              </div>
              <div>
                <span className="text-xs font-medium">Hide from roles</span>
                {pgRoles.length > 0 ? (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {pgRoles.map(r => (
                      <label key={r} className="flex items-center gap-1 text-xs px-2 py-1 border rounded cursor-pointer hover:bg-muted">
                        <input type="checkbox" checked={restrictedRoles.includes(r)} onChange={(e) => {
                          setRestrictedRoles(e.target.checked ? [...restrictedRoles, r] : restrictedRoles.filter(x => x !== r))
                        }} />
                        {r}
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground mt-1">No PG roles found. Sync a role first.</p>
                )}
              </div>
            </>
          )}

          <div className="flex gap-2 justify-end pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={submitting || !targetTable || !policyName || (type === "RLS" && !filterRole && bypassRoles.length === 0) || (type === "COLUMN" && (restrictedCols.length === 0 || restrictedRoles.length === 0))} className="btn-primary">
              {submitting ? "Adding..." : "Add Policy"}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
