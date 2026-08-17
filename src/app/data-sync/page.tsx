"use client"
function ConfigureStep({ selected, selectedDb, direction, targetSchema, setTargetSchema, syncMode, setSyncMode, incrementalKey, setIncrementalKey, submitting, result, onBack, onClose, onSubmit }: any) {
  const [detecting, setDetecting] = useState(false)
  const [perObjectConfig, setPerObjectConfig] = useState<Record<string, { mode: string, key: string, suggestedKey: string | null, keyReason: string, columns: any[] }>>({})
  const [localSubmitting, setLocalSubmitting] = useState(false)
  const [localResult, setLocalResult] = useState<any>(null)
  // Auto-detect keys for all selected objects on mount
  useEffect(() => {
    if (direction === "PG_TO_SF") {
      detectPgKeys()
    } else {
      detectAllKeys()
    }
  }, [])

  async function detectPgKeys() {
    setDetecting(true)
    const configs: Record<string, any> = {}
    for (const fqn of Array.from(selected)) {
      const [schema, table] = (fqn as string).split(".")
      try {
        const res = await fetch("/api/pg", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            instance_id: 1,
            sql: `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = '${schema}' AND table_name = '${table}' ORDER BY ordinal_position`
          }),
        })
        const data = await res.json()
        const columns = (data.rows || []).map((r: any) => ({ name: r.column_name, type: r.data_type }))
        // Suggest incremental key: prefer id/timestamp columns
        const timeCol = columns.find((c: any) => c.type.includes("timestamp") || c.name.includes("updated") || c.name.includes("modified") || c.name.includes("created"))
        const idCol = columns.find((c: any) => c.name === "id" || c.name.endsWith("_id"))
        const suggestedKey = timeCol?.name || idCol?.name || null
        const keyReason = timeCol ? `Timestamp column: ${timeCol.name}` : idCol ? `ID column: ${idCol.name}` : ""
        configs[fqn as string] = {
          mode: suggestedKey ? "INCREMENTAL" : "FULL",
          key: suggestedKey || "",
          suggestedKey,
          keyReason,
          columns,
        }
      } catch {
        configs[fqn as string] = { mode: "FULL", key: "", suggestedKey: null, keyReason: "Could not inspect PG table", columns: [] }
      }
    }
    setPerObjectConfig(configs)
    setDetecting(false)
  }

  async function detectAllKeys() {
    setDetecting(true)
    const configs: Record<string, any> = {}
    for (const fqn of Array.from(selected)) {
      const [db, schema, table] = (fqn as string).split(".")
      try {
        const res = await fetch(`/api/columns?database=${db}&schema=${schema}&table=${table}`)
        const data = await res.json()
        configs[fqn as string] = {
          mode: data.hasCandidate ? "INCREMENTAL" : "FULL",
          key: data.suggestedKey || "",
          suggestedKey: data.suggestedKey,
          keyReason: data.keyReason || "",
          columns: data.columns || [],
        }
      } catch {
        configs[fqn as string] = { mode: "FULL", key: "", suggestedKey: null, keyReason: "Could not inspect", columns: [] }
      }
    }
    setPerObjectConfig(configs)
    setDetecting(false)
  }

  function setObjectMode(fqn: string, mode: string) {
    setPerObjectConfig(prev => ({ ...prev, [fqn]: { ...prev[fqn], mode } }))
  }

  function setObjectKey(fqn: string, key: string) {
    setPerObjectConfig(prev => ({ ...prev, [fqn]: { ...prev[fqn], key } }))
  }

  function setAllMode(mode: string) {
    const updated = { ...perObjectConfig }
    for (const fqn of Object.keys(updated)) {
      updated[fqn] = { ...updated[fqn], mode }
      if (mode === "INCREMENTAL" && !updated[fqn].key && updated[fqn].suggestedKey) {
        updated[fqn].key = updated[fqn].suggestedKey!
      }
    }
    setPerObjectConfig(updated)
    setSyncMode(mode)
  }

  // Override onSubmit to use per-object configs
  async function handleConfiguredSubmit() {
    setLocalSubmitting(true)
    const items = Array.from(selected).map(fqn => {
      const parts = (fqn as string).split(".")
      const objCfg = perObjectConfig[fqn as string] || { mode: "FULL", key: "" }

      if (direction === "PG_TO_SF") {
        // PG tables: fqn is "schema.table"
        const [schema, table] = parts.length === 2 ? parts : [parts[0], parts[1]]
        return {
          source_database: null,
          source_schema: schema,
          source_object: table,
          target_database: "PGSYNC_DB",
          target_schema: targetSchema,
          target_table: table.toUpperCase(),
          sync_mode: objCfg.mode,
          incremental_key: objCfg.mode === "INCREMENTAL" ? objCfg.key : null,
        }
      } else {
        // SF tables: fqn is "database.schema.table"
        const [db, schema, table] = parts
        return {
          source_database: db,
          source_schema: schema,
          source_object: table,
          target_schema: targetSchema,
          target_table: table.toLowerCase(),
          sync_mode: objCfg.mode,
          incremental_key: objCfg.mode === "INCREMENTAL" ? objCfg.key : null,
        }
      }
    })

    // Use a custom bulk endpoint that supports per-item modes
    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "bulk_add_data_sync_v2",
          instance_id: 1,
          direction,
          items,
        }),
      })
      const data = await res.json()
      setLocalResult(data)
      if (data.added > 0) {
        setTimeout(() => { onClose() }, 1200)
      }
    } catch (e: any) {
      setLocalResult({ added: 0, results: [{ object: "unknown", status: "FAILED", error: e.message }] })
    }
    setLocalSubmitting(false)
  }

  return (
    <div className="flex-1 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          Configuring sync for <strong>{selected.size}</strong> object{selected.size !== 1 ? "s" : ""}
        </div>
        <div className="flex gap-2">
          <button onClick={() => setAllMode("FULL")} className={`text-xs px-2 py-1 rounded ${syncMode === "FULL" ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-muted"}`}>Set All FULL</button>
          <button onClick={() => setAllMode("INCREMENTAL")} className={`text-xs px-2 py-1 rounded ${syncMode === "INCREMENTAL" ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-muted"}`}>Set All INCREMENTAL</button>
        </div>
      </div>

      <label className="block">
        <span className="text-xs font-medium">{direction === "PG_TO_SF" ? "Target SF Schema" : "Target PG Schema"}</span>
        <input value={targetSchema} onChange={(e: any) => setTargetSchema(e.target.value)} className="input w-48" placeholder={direction === "PG_TO_SF" ? "STAGING" : "pgsync"} />
      </label>

      {detecting ? (
        <div className="text-sm text-muted-foreground animate-pulse p-4 text-center">Analyzing columns for each selected object...</div>
      ) : (
        <div className="border rounded-md overflow-auto max-h-[300px]">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 sticky top-0">
              <tr>
                <th className="text-left p-2 font-medium">Object</th>
                <th className="text-left p-2 font-medium w-32">Mode</th>
                <th className="text-left p-2 font-medium">Incremental Key</th>
                <th className="text-left p-2 font-medium w-48">Target</th>
              </tr>
            </thead>
            <tbody>
              {Array.from(selected).map(fqn => {
                const objCfg = perObjectConfig[fqn as string] || { mode: "FULL", key: "", suggestedKey: null, keyReason: "", columns: [] }
                const parts = (fqn as string).split(".")
                const table = parts.length === 3 ? parts[2] : parts[1]
                return (
                  <tr key={fqn as string} className="border-t">
                    <td className="p-2 font-mono text-xs">{fqn as string}</td>
                    <td className="p-2">
                      <select value={objCfg.mode} onChange={(e) => setObjectMode(fqn as string, e.target.value)} className="input text-xs py-1">
                        <option value="FULL">Full</option>
                        <option value="INCREMENTAL">Incremental</option>
                      </select>
                    </td>
                    <td className="p-2">
                      {objCfg.mode === "INCREMENTAL" ? (
                        <div className="flex flex-col gap-0.5">
                          <select value={objCfg.key} onChange={(e) => setObjectKey(fqn as string, e.target.value)} className="input text-xs py-1">
                            <option value="">None</option>
                            {objCfg.columns.map((c: any) => (
                              <option key={c.name} value={c.name}>{c.name}{c.name === objCfg.suggestedKey ? " ★" : ""}</option>
                            ))}
                          </select>
                          {objCfg.suggestedKey && <span className="text-xs text-green-600">★ {objCfg.keyReason}</span>}
                          {!objCfg.suggestedKey && <span className="text-xs text-yellow-600">No key detected</span>}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">N/A (full refresh)</span>
                      )}
                    </td>
                    <td className="p-2 font-mono text-xs text-muted-foreground">
                      {direction === "PG_TO_SF" ? `${targetSchema}.${table.toUpperCase()}` : `${targetSchema}.${table.toLowerCase()}`}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {localResult && (
        <div className={`p-3 rounded-md border text-sm ${localResult.added > 0 ? "bg-green-50 border-green-200 dark:bg-green-950 dark:border-green-800" : "bg-red-50 border-red-200 dark:bg-red-950 dark:border-red-800"}`}>
          Added <strong>{localResult.added}</strong> of {localResult.results?.length} sync configs.
          {localResult.results?.filter((r: any) => r.status === "FAILED").map((r: any, i: number) => (
            <div key={i} className="text-xs text-red-600 mt-1">{r.object}: {r.error}</div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between pt-2 border-t mt-auto">
        <button onClick={onBack} className="btn-secondary">← Back</button>
        <div className="flex gap-2">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={handleConfiguredSubmit} disabled={localSubmitting || detecting} className="btn-primary">
            {localSubmitting ? "Adding..." : `Add ${selected.size} Sync${selected.size !== 1 ? "s" : ""}`}
          </button>
        </div>
      </div>
    </div>
  )
}

import { useState, useEffect } from "react"
import { Database, Play, Plus, Trash2, RefreshCw } from "lucide-react"
import { useInstance } from "@/components/instance-provider"

interface DataConfig {
  CONFIG_ID: number
  INSTANCE_ID: number
  DIRECTION: string
  SOURCE_DATABASE: string | null
  SOURCE_SCHEMA: string
  SOURCE_OBJECT: string
  TARGET_DATABASE: string | null
  TARGET_SCHEMA: string
  TARGET_TABLE: string
  SYNC_MODE: string
  INCREMENTAL_KEY: string | null
  LAST_SYNC_VALUE: string | null
  ENABLED: boolean
}

export default function DataSyncPage() {
  const [configs, setConfigs] = useState<DataConfig[]>([])
  const [instances, setInstances] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState<number | null>(null)
  const [syncResult, setSyncResult] = useState<any>(null)
  const [showAdd, setShowAdd] = useState(false)
  const { selectedInstance } = useInstance()

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    const res = await fetch("/api/config")
    const data = await res.json()
    setConfigs(data.dataConfigs || [])
    setInstances(data.instances || [])
    setLoading(false)
  }

  async function triggerSync(configId: number) {
    setSyncing(configId)
    setSyncResult(null)
    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "data_single", config_id: configId }),
      })
      const data = await res.json()
      if (data.error) {
        setSyncResult({ status: "FAILED", error: data.error })
      } else {
        setSyncResult(data.result || { status: "SUCCESS" })
      }
    } catch (e: any) {
      setSyncResult({ status: "FAILED", error: e.message || "Network error" })
    }
    setSyncing(null)
    loadData()
  }

  async function triggerSyncAll(instanceId: number) {
    setSyncing(-1)
    setSyncResult(null)
    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "data_all", instance_id: instanceId }),
      })
      const data = await res.json()
      if (data.error) {
        setSyncResult({ status: "FAILED", error: data.error })
      } else {
        setSyncResult(data.result || { status: "SUCCESS" })
      }
    } catch (e: any) {
      setSyncResult({ status: "FAILED", error: e.message || "Network error" })
    }
    setSyncing(null)
    loadData()
  }

  async function deleteConfig(configId: number) {
    await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete_data_sync", config_id: configId }),
    })
    loadData()
  }

  async function toggleConfig(configId: number, enabled: boolean) {
    await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "toggle_data_sync", config_id: configId, enabled }),
    })
    loadData()
  }

  if (loading) return <div className="text-sm text-muted-foreground">Loading...</div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Data Sync</h1>
          <p className="text-sm text-muted-foreground mt-1">Configure and run table syncs between Snowflake and Postgres</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => triggerSyncAll(selectedInstance)} disabled={syncing !== null} className="btn-secondary">
            <RefreshCw size={14} className={syncing === -1 ? "animate-spin" : ""} />
            Sync All
          </button>
          <button onClick={() => setShowAdd(true)} className="btn-primary">
            <Plus size={14} />
            Add Sync
          </button>
        </div>
      </div>

      {syncing !== null && (
        <div className="p-4 rounded-md border border-blue-200 bg-blue-50 dark:bg-blue-950 dark:border-blue-800 flex items-center gap-3">
          <RefreshCw size={16} className="animate-spin text-blue-600" />
          <span className="text-sm font-medium">Syncing in progress... This may take a few seconds.</span>
        </div>
      )}

      {syncResult && syncing === null && (
        <div className={`p-4 rounded-md text-sm border ${syncResult.status === "SUCCESS" ? "bg-green-50 border-green-200 dark:bg-green-950 dark:border-green-800" : syncResult.status === "PARTIAL" ? "bg-yellow-50 border-yellow-200 dark:bg-yellow-950 dark:border-yellow-800" : "bg-red-50 border-red-200 dark:bg-red-950 dark:border-red-800"}`}>
          <div className="flex items-center justify-between">
            <div>
              <strong className="text-base">{syncResult.status === "SUCCESS" ? "Sync Complete" : syncResult.status === "PARTIAL" ? "Partial Success" : "Sync Failed"}</strong>
              {syncResult.rows_synced !== undefined && <p className="mt-1">Synced <strong>{syncResult.rows_synced}</strong> rows from <code>{syncResult.source}</code> → <code>{syncResult.target}</code> in {syncResult.duration_seconds}s</p>}
              {syncResult.error && <p className="mt-1 text-red-700 dark:text-red-300">{syncResult.error}</p>}
              {syncResult.details && <p className="mt-1">{syncResult.successes}/{syncResult.total} configs succeeded</p>}
            </div>
            <button onClick={() => setSyncResult(null)} className="text-muted-foreground hover:text-foreground">✕</button>
          </div>
        </div>
      )}

      <SyncTable
        title="Snowflake → Postgres"
        configs={configs.filter(c => c.DIRECTION === "SF_TO_PG")}
        syncing={syncing}
        onSync={triggerSync}
        onDelete={deleteConfig}
        onToggle={toggleConfig}
        dirLabel="SF → PG"
      />

      <SyncTable
        title="Postgres → Snowflake"
        configs={configs.filter(c => c.DIRECTION === "PG_TO_SF")}
        syncing={syncing}
        onSync={triggerSync}
        onDelete={deleteConfig}
        onToggle={toggleConfig}
        dirLabel="PG → SF"
      />

      {showAdd && <AddDataSyncModal onClose={() => { setShowAdd(false); loadData() }} onAdded={loadData} instances={instances} />}
    </div>
  )
}

function SyncTable({ title, configs, syncing, onSync, onDelete, onToggle, dirLabel }: {
  title: string, configs: DataConfig[], syncing: number | null,
  onSync: (id: number) => void, onDelete: (id: number) => void,
  onToggle: (id: number, enabled: boolean) => void, dirLabel: string
}) {
  const [sortCol, setSortCol] = useState<string>("SOURCE_OBJECT")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")

  function handleSort(col: string) {
    if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc")
    else { setSortCol(col); setSortDir("asc") }
  }

  const sorted = [...configs].sort((a: any, b: any) => {
    const av = a[sortCol] ?? ""
    const bv = b[sortCol] ?? ""
    const cmp = String(av).localeCompare(String(bv))
    return sortDir === "asc" ? cmp : -cmp
  })

  const SortHeader = ({ col, label }: { col: string, label: string }) => (
    <th onClick={() => handleSort(col)} className="text-left p-2 font-medium cursor-pointer hover:text-primary select-none">
      {label} {sortCol === col && (sortDir === "asc" ? "↑" : "↓")}
    </th>
  )

  return (
    <div>
      <h2 className="text-sm font-semibold mb-2 text-muted-foreground">{title} ({configs.length})</h2>
      {configs.length === 0 ? (
        <div className="border rounded-md p-4 text-center text-sm text-muted-foreground">No {dirLabel} syncs configured.</div>
      ) : (
        <div className="border rounded-md overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <SortHeader col="SOURCE_OBJECT" label="Source" />
                <SortHeader col="TARGET_TABLE" label="Target" />
                <SortHeader col="SYNC_MODE" label="Mode" />
                <SortHeader col="LAST_SYNC_VALUE" label="Last Sync" />
                <th className="text-left p-2 font-medium">Enabled</th>
                <th className="text-left p-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((cfg) => (
                <tr key={cfg.CONFIG_ID} className="border-t">
                  <td className="p-2 font-mono text-xs">
                    {cfg.DIRECTION === "SF_TO_PG"
                      ? `${cfg.SOURCE_DATABASE}.${cfg.SOURCE_SCHEMA}.${cfg.SOURCE_OBJECT}`
                      : `${cfg.SOURCE_SCHEMA}.${cfg.SOURCE_OBJECT}`}
                  </td>
                  <td className="p-2 font-mono text-xs">
                    {cfg.DIRECTION === "PG_TO_SF"
                      ? `${cfg.TARGET_DATABASE}.${cfg.TARGET_SCHEMA}.${cfg.TARGET_TABLE}`
                      : `${cfg.TARGET_SCHEMA}.${cfg.TARGET_TABLE}`}
                  </td>
                  <td className="p-2">
                    <span className="text-xs">{cfg.SYNC_MODE}</span>
                    {cfg.INCREMENTAL_KEY && <span className="text-xs text-muted-foreground ml-1">({cfg.INCREMENTAL_KEY})</span>}
                  </td>
                  <td className="p-2 text-xs text-muted-foreground">{cfg.LAST_SYNC_VALUE || "Never"}</td>
                  <td className="p-2">
                    <button onClick={() => onToggle(cfg.CONFIG_ID, !cfg.ENABLED)} className={`w-8 h-4 rounded-full relative transition-colors ${cfg.ENABLED ? "bg-green-500" : "bg-gray-300 dark:bg-gray-600"}`}>
                      <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${cfg.ENABLED ? "left-4" : "left-0.5"}`} />
                    </button>
                  </td>
                  <td className="p-2">
                    <div className="flex gap-1">
                      <button onClick={() => onSync(cfg.CONFIG_ID)} disabled={syncing !== null || !cfg.ENABLED} className="p-1 rounded hover:bg-muted" title="Sync Now">
                        <Play size={14} className={syncing === cfg.CONFIG_ID ? "animate-pulse text-green-600" : ""} />
                      </button>
                      <button onClick={() => onDelete(cfg.CONFIG_ID)} className="p-1 rounded hover:bg-muted text-red-500" title="Delete">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function AddDataSyncModal({ onClose, onAdded, instances }: { onClose: () => void; onAdded: () => void; instances: any[] }) {
  const [step, setStep] = useState<"browse" | "configure">("browse")
  const [instanceId, setInstanceId] = useState(instances[0]?.INSTANCE_ID || 1)
  const [direction, setDirection] = useState("SF_TO_PG")

  // Browse state
  const [databases, setDatabases] = useState<string[]>([])
  const [selectedDb, setSelectedDb] = useState("")
  const [schemas, setSchemas] = useState<string[]>([])
  const [expandedSchemas, setExpandedSchemas] = useState<Set<string>>(new Set())
  const [schemaObjects, setSchemaObjects] = useState<Record<string, any[]>>({})
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loadingSchemas, setLoadingSchemas] = useState(false)
  const [loadingTables, setLoadingTables] = useState<string | null>(null)
  const [pgTables, setPgTables] = useState<any[]>([])
  const [loadingPg, setLoadingPg] = useState(false)

  // Configure state
  const [targetSchema, setTargetSchema] = useState(direction === "PG_TO_SF" ? "PGSYNC" : "pgsync")
  const [syncMode, setSyncMode] = useState("FULL")
  const [incrementalKey, setIncrementalKey] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<any>(null)

  // Load databases on mount (SF direction) or PG tables (PG direction)
  useEffect(() => {
    if (direction === "SF_TO_PG") {
      fetch("/api/browse?level=databases").then(r => r.json()).then(setDatabases)
      setTargetSchema("pgsync")
    } else {
      loadPgTables()
      setTargetSchema("PGSYNC")
    }
    setSelected(new Set())
  }, [direction])

  async function loadSchemas(db: string) {
    setSelectedDb(db)
    setLoadingSchemas(true)
    setSchemas([])
    setExpandedSchemas(new Set())
    setSchemaObjects({})
    setSelected(new Set())
    const res = await fetch(`/api/browse?level=schemas&database=${db}`)
    const data = await res.json()
    setSchemas(data)
    setLoadingSchemas(false)
  }

  async function loadPgTables() {
    setLoadingPg(true)
    const res = await fetch("/api/pg", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        instance_id: instanceId,
        sql: "SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema', 'snowflake_auth', 'snowflake_cdc', 'lake_engine', 'lake_iceberg', 'lake_table', 'cron', '__pg_lake_table_writes') AND table_type = 'BASE TABLE' ORDER BY table_schema, table_name"
      }),
    })
    const data = await res.json()
    setPgTables(data.rows || [])
    setLoadingPg(false)
  }

  async function toggleSchema(schema: string) {
    const newExpanded = new Set(expandedSchemas)
    if (newExpanded.has(schema)) {
      newExpanded.delete(schema)
    } else {
      newExpanded.add(schema)
      if (!schemaObjects[schema]) {
        setLoadingTables(schema)
        const res = await fetch(`/api/browse?level=tables&database=${selectedDb}&schema=${schema}`)
        const data = await res.json()
        setSchemaObjects(prev => ({ ...prev, [schema]: data }))
        setLoadingTables(null)
      }
    }
    setExpandedSchemas(newExpanded)
  }

  function selectAllInSchema(schema: string) {
    const objects = schemaObjects[schema] || []
    const newSelected = new Set(selected)
    const keys = objects.map((o: any) => `${selectedDb}.${schema}.${o.TABLE_NAME}`)
    const allSelected = keys.every(k => newSelected.has(k))
    if (allSelected) {
      keys.forEach(k => newSelected.delete(k))
    } else {
      keys.forEach(k => newSelected.add(k))
    }
    setSelected(newSelected)
  }

  function toggleObject(fqn: string) {
    const newSelected = new Set(selected)
    if (newSelected.has(fqn)) newSelected.delete(fqn)
    else newSelected.add(fqn)
    setSelected(newSelected)
  }

  async function handleSubmit() {
    setSubmitting(true)
    const items = Array.from(selected).map(fqn => {
      const [db, schema, table] = fqn.split(".")
      return {
        source_database: db,
        source_schema: schema,
        source_object: table,
        target_schema: targetSchema,
        target_table: table.toLowerCase(),
      }
    })
    const res = await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "bulk_add_data_sync",
        instance_id: instanceId,
        direction,
        sync_mode: syncMode,
        incremental_key: incrementalKey || null,
        target_database: direction === "PG_TO_SF" ? "PGSYNC_DB" : null,
        items,
      }),
    })
    const data = await res.json()
    setResult(data)
    setSubmitting(false)
    if (data.added > 0) onAdded()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-background border rounded-lg p-6 w-full max-w-3xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Add Data Sync — {step === "browse" ? "Select Objects" : "Configure"}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">✕</button>
        </div>

        {step === "browse" && (
          <div className="flex-1 overflow-hidden flex flex-col gap-3">
            <div className="grid grid-cols-3 gap-3">
              <label className="block">
                <span className="text-xs font-medium">PG Instance</span>
                <select value={instanceId} onChange={(e) => setInstanceId(Number(e.target.value))} className="input">
                  {instances.map((i: any) => <option key={i.INSTANCE_ID} value={i.INSTANCE_ID}>{i.INSTANCE_NAME}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-medium">Direction</span>
                <select value={direction} onChange={(e) => setDirection(e.target.value)} className="input">
                  <option value="SF_TO_PG">Snowflake → Postgres</option>
                  <option value="PG_TO_SF">Postgres → Snowflake</option>
                </select>
              </label>
              {direction === "SF_TO_PG" && (
                <label className="block">
                  <span className="text-xs font-medium">Database</span>
                  <select value={selectedDb} onChange={(e) => loadSchemas(e.target.value)} className="input">
                    <option value="">Select database...</option>
                    {databases.map(db => <option key={db} value={db}>{db}</option>)}
                  </select>
                </label>
              )}
            </div>

            <div className="flex-1 overflow-auto border rounded-md p-2 min-h-[300px]">
              {direction === "PG_TO_SF" ? (
                <>
                  {loadingPg && <p className="text-sm text-muted-foreground p-2">Loading PG tables...</p>}
                  {!loadingPg && pgTables.length === 0 && <p className="text-sm text-muted-foreground p-2">No tables found in Postgres instance</p>}
                  {pgTables.map((t: any) => {
                    const fqn = `${t.table_schema}.${t.table_name}`
                    return (
                      <label key={fqn} className="flex items-center gap-2 px-2 py-1 hover:bg-muted/30 rounded cursor-pointer text-sm">
                        <input type="checkbox" checked={selected.has(fqn)} onChange={() => toggleObject(fqn)} className="rounded" />
                        <span className="font-mono text-xs">{t.table_schema}.<strong>{t.table_name}</strong></span>
                      </label>
                    )
                  })}
                </>
              ) : (
                <>
              {!selectedDb && <p className="text-sm text-muted-foreground p-2">Select a database to browse objects</p>}
              {loadingSchemas && <p className="text-sm text-muted-foreground p-2">Loading schemas...</p>}
              {schemas.map(schema => {
                const objects = schemaObjects[schema] || []
                const isExpanded = expandedSchemas.has(schema)
                const schemaKeys = objects.map((o: any) => `${selectedDb}.${schema}.${o.TABLE_NAME}`)
                const allSelected = schemaKeys.length > 0 && schemaKeys.every(k => selected.has(k))
                const someSelected = schemaKeys.some(k => selected.has(k))

                return (
                  <div key={schema} className="mb-1">
                    <div className="flex items-center gap-2 px-2 py-1 hover:bg-muted/50 rounded cursor-pointer">
                      <button onClick={() => toggleSchema(schema)} className="text-xs w-4">
                        {isExpanded ? "▼" : "▶"}
                      </button>
                      <input
                        type="checkbox"
                        checked={allSelected}
                        ref={el => { if (el) el.indeterminate = someSelected && !allSelected }}
                        onChange={() => { if (objects.length > 0) selectAllInSchema(schema); else toggleSchema(schema) }}
                        className="rounded"
                      />
                      <span className="text-sm font-medium" onClick={() => toggleSchema(schema)}>{schema}</span>
                      {objects.length > 0 && <span className="text-xs text-muted-foreground">({objects.length} objects)</span>}
                      {loadingTables === schema && <span className="text-xs text-muted-foreground animate-pulse">loading...</span>}
                    </div>
                    {isExpanded && objects.length > 0 && (
                      <div className="ml-8 border-l pl-2">
                        {objects.map((obj: any) => {
                          const fqn = `${selectedDb}.${schema}.${obj.TABLE_NAME}`
                          return (
                            <label key={fqn} className="flex items-center gap-2 px-2 py-0.5 hover:bg-muted/30 rounded cursor-pointer text-sm">
                              <input type="checkbox" checked={selected.has(fqn)} onChange={() => toggleObject(fqn)} className="rounded" />
                              <span className="font-mono text-xs">{obj.TABLE_NAME}</span>
                              <span className={`text-xs px-1 rounded ${obj.TABLE_TYPE === "VIEW" ? "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300" : "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300"}`}>
                                {obj.TABLE_TYPE === "BASE TABLE" ? "TABLE" : "VIEW"}
                              </span>
                              {obj.ROW_COUNT != null && <span className="text-xs text-muted-foreground ml-auto">{Number(obj.ROW_COUNT).toLocaleString()} rows</span>}
                            </label>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
                </>
              )}
            </div>

            <div className="flex items-center justify-between pt-2 border-t">
              <span className="text-sm text-muted-foreground">{selected.size} object{selected.size !== 1 ? "s" : ""} selected</span>
              <div className="flex gap-2">
                <button onClick={onClose} className="btn-secondary">Cancel</button>
                <button onClick={() => setStep("configure")} disabled={selected.size === 0} className="btn-primary">
                  Next: Configure →
                </button>
              </div>
            </div>
          </div>
        )}

        {step === "configure" && (
          <ConfigureStep
            selected={selected}
            selectedDb={selectedDb}
            direction={direction}
            targetSchema={targetSchema}
            setTargetSchema={setTargetSchema}
            syncMode={syncMode}
            setSyncMode={setSyncMode}
            incrementalKey={incrementalKey}
            setIncrementalKey={setIncrementalKey}
            submitting={submitting}
            result={result}
            onBack={() => setStep("browse")}
            onClose={onClose}
            onSubmit={handleSubmit}
          />
        )}
      </div>
    </div>
  )
}
