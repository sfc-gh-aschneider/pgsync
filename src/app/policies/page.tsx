"use client"

import { useState, useEffect } from "react"
import { Shield, Plus, Trash2, Play, Lock, Eye } from "lucide-react"

export default function PoliciesPage() {
  const [policies, setPolicies] = useState<any[]>([])
  const [syncedTables, setSyncedTables] = useState<any[]>([])
  const [roles, setRoles] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState<"RLS" | "COLUMN" | null>(null)
  const [applyResult, setApplyResult] = useState<any>(null)
  const [applying, setApplying] = useState(false)

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    const res = await fetch("/api/policies")
    const data = await res.json()
    setPolicies(data.policies || [])
    setSyncedTables(data.syncedTables || [])
    setRoles(data.roles || [])
    setLoading(false)
  }

  async function applyPolicies() {
    setApplying(true)
    setApplyResult(null)
    const res = await fetch("/api/policies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "apply", instance_id: 1 }),
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

  const rlsPolicies = policies.filter((p: any) => p.POLICY_TYPE === "RLS")
  const columnPolicies = policies.filter((p: any) => p.POLICY_TYPE === "COLUMN")

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Security Policies</h1>
          <p className="text-sm text-muted-foreground mt-1">Row-Level Security and column restrictions on synced PG tables</p>
        </div>
        <button onClick={applyPolicies} disabled={applying || policies.length === 0} className="btn-primary">
          <Play size={14} className={applying ? "animate-pulse" : ""} />
          {applying ? "Applying..." : "Apply All Policies"}
        </button>
      </div>

      {applyResult && (
        <div className={`p-3 rounded-md text-sm border ${applyResult.status === "SUCCESS" ? "bg-green-50 border-green-200 dark:bg-green-950 dark:border-green-800" : "bg-yellow-50 border-yellow-200 dark:bg-yellow-950 dark:border-yellow-800"}`}>
          <div className="flex justify-between">
            <div>
              <strong>{applyResult.status}</strong> — {applyResult.duration_seconds}s
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
          <button onClick={() => setShowAdd("RLS")} className="btn-primary text-xs" disabled={syncedTables.length === 0}>
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
                  <th className="text-left p-2 font-medium">Applied</th>
                  <th className="text-left p-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rlsPolicies.map((p: any) => {
                  const def = typeof p.POLICY_DEFINITION === "string" ? JSON.parse(p.POLICY_DEFINITION) : p.POLICY_DEFINITION
                  return (
                    <tr key={p.POLICY_ID} className="border-t">
                      <td className="p-2 font-mono text-xs">{p.POLICY_NAME}</td>
                      <td className="p-2 font-mono text-xs">{p.TARGET_SCHEMA}.{p.TARGET_TABLE}</td>
                      <td className="p-2 text-xs">
                        {def.bypass_roles?.length > 0 && <div>Bypass: {def.bypass_roles.join(", ")}</div>}
                        {def.filter_role && <div>{def.filter_role}: {def.filter}</div>}
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
          <button onClick={() => setShowAdd("COLUMN")} className="btn-primary text-xs" disabled={syncedTables.length === 0}>
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
                  <th className="text-left p-2 font-medium">Restricted Columns</th>
                  <th className="text-left p-2 font-medium">From Roles</th>
                  <th className="text-left p-2 font-medium">Applied</th>
                  <th className="text-left p-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {columnPolicies.map((p: any) => {
                  const def = typeof p.POLICY_DEFINITION === "string" ? JSON.parse(p.POLICY_DEFINITION) : p.POLICY_DEFINITION
                  return (
                    <tr key={p.POLICY_ID} className="border-t">
                      <td className="p-2 font-mono text-xs">{p.POLICY_NAME}</td>
                      <td className="p-2 font-mono text-xs">{p.TARGET_SCHEMA}.{p.TARGET_TABLE}</td>
                      <td className="p-2 text-xs">{def.restricted_columns?.join(", ")}</td>
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
          syncedTables={syncedTables}
          roles={roles}
          onClose={() => setShowAdd(null)}
          onAdded={loadData}
        />
      )}
    </div>
  )
}

function AddPolicyModal({ type, syncedTables, roles, onClose, onAdded }: {
  type: "RLS" | "COLUMN", syncedTables: any[], roles: string[],
  onClose: () => void, onAdded: () => void
}) {
  const [targetTable, setTargetTable] = useState("")
  const [policyName, setPolicyName] = useState("")
  const [submitting, setSubmitting] = useState(false)

  // RLS-specific
  const [bypassRoles, setBypassRoles] = useState<string[]>([])
  const [filterRole, setFilterRole] = useState("")
  const [filterExpr, setFilterExpr] = useState("")

  // Column-specific
  const [restrictedCols, setRestrictedCols] = useState("")
  const [restrictedRoles, setRestrictedRoles] = useState<string[]>([])

  // Load columns when table selected
  const [columns, setColumns] = useState<string[]>([])
  useEffect(() => {
    if (targetTable && type === "COLUMN") {
      const [schema, table] = targetTable.split(".")
      // We'd need the source DB info but for now just use the table
      setColumns([])
    }
  }, [targetTable])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    const [schema, table] = targetTable.split(".")

    const definition = type === "RLS"
      ? { bypass_roles: bypassRoles, filter_role: filterRole, filter: filterExpr }
      : { restricted_columns: restrictedCols.split(",").map(c => c.trim()).filter(Boolean), restricted_from_roles: restrictedRoles }

    await fetch("/api/policies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "add",
        instance_id: 1,
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
      <div className="bg-background border rounded-lg p-6 w-full max-w-lg">
        <h2 className="text-lg font-semibold mb-4">Add {type === "RLS" ? "Row-Level Security Policy" : "Column Restriction"}</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium">Target Table</span>
              <select value={targetTable} onChange={(e) => setTargetTable(e.target.value)} className="input">
                <option value="">Select table...</option>
                {syncedTables.map((t: any) => (
                  <option key={`${t.TARGET_SCHEMA}.${t.TARGET_TABLE}`} value={`${t.TARGET_SCHEMA}.${t.TARGET_TABLE}`}>
                    {t.TARGET_SCHEMA}.{t.TARGET_TABLE}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium">Policy Name</span>
              <input value={policyName} onChange={(e) => setPolicyName(e.target.value.replace(/[^a-z0-9_]/g, "_"))} className="input" placeholder="team_access_policy" />
            </label>
          </div>

          {type === "RLS" && (
            <>
              <div>
                <span className="text-xs font-medium">Bypass Roles (can see all rows)</span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {roles.map(r => (
                    <label key={r} className="flex items-center gap-1 text-xs px-2 py-1 border rounded cursor-pointer hover:bg-muted">
                      <input type="checkbox" checked={bypassRoles.includes(r)} onChange={(e) => {
                        setBypassRoles(e.target.checked ? [...bypassRoles, r] : bypassRoles.filter(x => x !== r))
                      }} />
                      {r}
                    </label>
                  ))}
                  {roles.length === 0 && <span className="text-xs text-muted-foreground">No roles synced yet. Add roles in Role Sync first.</span>}
                </div>
              </div>
              <label className="block">
                <span className="text-xs font-medium">Filtered Role (sees restricted rows)</span>
                <select value={filterRole} onChange={(e) => setFilterRole(e.target.value)} className="input">
                  <option value="">None (policy applies to all non-bypass)</option>
                  {roles.filter(r => !bypassRoles.includes(r)).map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-medium">Filter Expression (SQL WHERE clause)</span>
                <input value={filterExpr} onChange={(e) => setFilterExpr(e.target.value)} className="input font-mono text-xs" placeholder="team_id = 'BULLDOGS'" />
                <span className="text-xs text-muted-foreground mt-0.5 block">Rows where this is TRUE are visible to the filtered role</span>
              </label>
            </>
          )}

          {type === "COLUMN" && (
            <>
              <label className="block">
                <span className="text-xs font-medium">Restricted Columns (comma-separated)</span>
                <input value={restrictedCols} onChange={(e) => setRestrictedCols(e.target.value)} className="input font-mono text-xs" placeholder="salary, medical_notes, contract_value" />
              </label>
              <div>
                <span className="text-xs font-medium">Restricted From Roles</span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {roles.map(r => (
                    <label key={r} className="flex items-center gap-1 text-xs px-2 py-1 border rounded cursor-pointer hover:bg-muted">
                      <input type="checkbox" checked={restrictedRoles.includes(r)} onChange={(e) => {
                        setRestrictedRoles(e.target.checked ? [...restrictedRoles, r] : restrictedRoles.filter(x => x !== r))
                      }} />
                      {r}
                    </label>
                  ))}
                </div>
              </div>
            </>
          )}

          <div className="flex gap-2 justify-end pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={submitting || !targetTable || !policyName} className="btn-primary">
              {submitting ? "Adding..." : "Add Policy"}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
