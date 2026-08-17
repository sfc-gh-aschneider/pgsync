"use client"

import { useState, useEffect } from "react"
import { Play, Pause, Trash2, Plus } from "lucide-react"

export default function AutomationPage() {
  const [tasks, setTasks] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)

  useEffect(() => { loadTasks() }, [])

  async function loadTasks() {
    setLoading(true)
    const res = await fetch("/api/tasks")
    const data = await res.json()
    setTasks(data.tasks || [])
    setLoading(false)
  }

  async function taskAction(action: string, taskName: string) {
    await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, task_name: taskName }),
    })
    loadTasks()
  }

  if (loading) return <div className="text-sm text-muted-foreground">Loading...</div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Automation</h1>
          <p className="text-sm text-muted-foreground mt-1">Schedule automatic syncs using Snowflake Tasks</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary">
          <Plus size={14} /> Create Task
        </button>
      </div>

      <div className="border rounded-md overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left p-2 font-medium">Task Name</th>
              <th className="text-left p-2 font-medium">Schedule</th>
              <th className="text-left p-2 font-medium">State</th>
              <th className="text-left p-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((task: any, i: number) => (
              <tr key={i} className="border-t">
                <td className="p-2 font-mono text-xs">{task.name}</td>
                <td className="p-2 text-xs">{task.schedule || "-"}</td>
                <td className="p-2">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${task.state === "started" ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" : "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200"}`}>
                    {task.state}
                  </span>
                </td>
                <td className="p-2 flex gap-1">
                  {task.state === "started" ? (
                    <button onClick={() => taskAction("suspend", task.name)} className="p-1 rounded hover:bg-muted" title="Suspend"><Pause size={14} /></button>
                  ) : (
                    <button onClick={() => taskAction("resume", task.name)} className="p-1 rounded hover:bg-muted text-green-600" title="Resume"><Play size={14} /></button>
                  )}
                  <button onClick={() => taskAction("drop", task.name)} className="p-1 rounded hover:bg-muted text-red-500" title="Drop"><Trash2 size={14} /></button>
                </td>
              </tr>
            ))}
            {tasks.length === 0 && (
              <tr><td colSpan={4} className="p-4 text-center text-muted-foreground">No tasks configured. Create one to automate syncs.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showCreate && <CreateTaskModal onClose={() => setShowCreate(false)} onCreated={loadTasks} />}
    </div>
  )
}

const DAYS_OF_WEEK = [
  { value: "1", label: "Monday" },
  { value: "2", label: "Tuesday" },
  { value: "3", label: "Wednesday" },
  { value: "4", label: "Thursday" },
  { value: "5", label: "Friday" },
  { value: "6", label: "Saturday" },
  { value: "0", label: "Sunday" },
]

function buildSchedule(frequency: string, hour: string, minute: string, dayOfWeek: string): string {
  switch (frequency) {
    case "5min": return "5 MINUTE"
    case "10min": return "10 MINUTE"
    case "15min": return "15 MINUTE"
    case "hourly": return "60 MINUTE"
    case "daily": return `USING CRON ${minute} ${hour} * * * UTC`
    case "weekly": return `USING CRON ${minute} ${hour} * * ${dayOfWeek} UTC`
    default: return "60 MINUTE"
  }
}

function CreateTaskModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [syncScope, setSyncScope] = useState("data_multi")
  const [frequency, setFrequency] = useState("hourly")
  const [hour, setHour] = useState("8")
  const [minute, setMinute] = useState("0")
  const [dayOfWeek, setDayOfWeek] = useState("1")
  const [taskName, setTaskName] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  // Data configs for multi-select
  const [dataConfigs, setDataConfigs] = useState<any[]>([])
  const [selectedConfigs, setSelectedConfigs] = useState<Set<number>>(new Set())
  const [loadingConfigs, setLoadingConfigs] = useState(false)

  useEffect(() => {
    loadConfigs()
  }, [])

  async function loadConfigs() {
    setLoadingConfigs(true)
    const res = await fetch("/api/config")
    const data = await res.json()
    setDataConfigs(data.dataConfigs || [])
    setLoadingConfigs(false)
  }

  function toggleConfig(id: number) {
    const next = new Set(selectedConfigs)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelectedConfigs(next)
  }

  function selectAll() {
    if (selectedConfigs.size === dataConfigs.length) {
      setSelectedConfigs(new Set())
    } else {
      setSelectedConfigs(new Set(dataConfigs.map(c => c.CONFIG_ID)))
    }
  }

  // Auto-generate task name
  useEffect(() => {
    const freqLabel = frequency === "5min" ? "5MIN" : frequency === "10min" ? "10MIN" : frequency === "15min" ? "15MIN" : frequency.toUpperCase()
    if (syncScope === "data_multi") {
      const count = selectedConfigs.size
      if (count === 1) {
        const cfg = dataConfigs.find(c => c.CONFIG_ID === Array.from(selectedConfigs)[0])
        const name = cfg ? cfg.SOURCE_OBJECT : "TABLE"
        setTaskName(`SYNC_${name}_${freqLabel}`.toUpperCase())
      } else if (count > 1) {
        setTaskName(`SYNC_${count}_TABLES_${freqLabel}`)
      } else {
        setTaskName("")
      }
    } else if (syncScope === "data_all") {
      setTaskName(`SYNC_ALL_DATA_${freqLabel}`)
    } else if (syncScope === "roles") {
      setTaskName(`SYNC_ROLES_${freqLabel}`)
    } else if (syncScope === "users") {
      setTaskName(`SYNC_USERS_${freqLabel}`)
    } else {
      setTaskName(`FULL_SYNC_${freqLabel}`)
    }
  }, [syncScope, frequency, selectedConfigs, dataConfigs])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    if (syncScope === "data_multi" && selectedConfigs.size === 0) {
      setError("Select at least one data sync config")
      return
    }
    if (!taskName) {
      setError("Task name is required")
      return
    }

    setSubmitting(true)
    const schedule = buildSchedule(frequency, hour, minute, dayOfWeek)
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create",
        task_name: taskName,
        instance_id: 1,
        schedule,
        sync_scope: syncScope,
        config_ids: syncScope === "data_multi" ? Array.from(selectedConfigs) : undefined,
      }),
    })
    const data = await res.json()
    setSubmitting(false)
    if (data.error) {
      setError(data.error)
    } else {
      onCreated()
      onClose()
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-background border rounded-lg p-6 w-full max-w-lg max-h-[85vh] overflow-auto">
        <h2 className="text-lg font-semibold mb-4">Create Scheduled Task</h2>
        <form onSubmit={handleSubmit} className="space-y-4">

          {/* Sync Scope */}
          <div>
            <span className="text-xs font-medium block mb-1">What to sync</span>
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: "data_multi", label: "Specific Data Syncs" },
                { value: "data_all", label: "All Data Syncs" },
                { value: "roles", label: "Role Sync" },
                { value: "users", label: "User Sync" },
              ].map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setSyncScope(opt.value)}
                  className={`text-xs px-3 py-2 rounded border text-left ${syncScope === opt.value ? "border-primary bg-primary/10 font-medium" : "border-muted hover:border-primary/50"}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Config multi-select (for data_multi) */}
          {syncScope === "data_multi" && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium">Select data syncs to include</span>
                <button type="button" onClick={selectAll} className="text-xs text-primary hover:underline">
                  {selectedConfigs.size === dataConfigs.length ? "Deselect all" : "Select all"}
                </button>
              </div>
              {loadingConfigs ? (
                <div className="text-xs text-muted-foreground p-2">Loading configs...</div>
              ) : dataConfigs.length === 0 ? (
                <div className="text-xs text-muted-foreground p-2 border rounded">No data syncs configured. Add some on the Data Sync page first.</div>
              ) : (
                <div className="border rounded max-h-[160px] overflow-auto">
                  {dataConfigs.map((cfg: any) => (
                    <label key={cfg.CONFIG_ID} className="flex items-center gap-2 px-2 py-1.5 hover:bg-muted/30 cursor-pointer text-xs border-b last:border-b-0">
                      <input type="checkbox" checked={selectedConfigs.has(cfg.CONFIG_ID)} onChange={() => toggleConfig(cfg.CONFIG_ID)} className="rounded" />
                      <span className="font-mono">
                        {cfg.DIRECTION === "SF_TO_PG" ? `${cfg.SOURCE_DATABASE}.${cfg.SOURCE_SCHEMA}.${cfg.SOURCE_OBJECT}` : `${cfg.SOURCE_SCHEMA}.${cfg.SOURCE_OBJECT}`}
                      </span>
                      <span className="text-muted-foreground ml-auto">{cfg.DIRECTION === "SF_TO_PG" ? "→ PG" : "→ SF"}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Schedule */}
          <div>
            <span className="text-xs font-medium block mb-1">Frequency</span>
            <select value={frequency} onChange={(e) => setFrequency(e.target.value)} className="input">
              <option value="5min">Every 5 minutes</option>
              <option value="10min">Every 10 minutes</option>
              <option value="15min">Every 15 minutes</option>
              <option value="hourly">Hourly</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </select>
          </div>

          {/* Time picker for daily/weekly */}
          {(frequency === "daily" || frequency === "weekly") && (
            <div className="flex gap-3">
              {frequency === "weekly" && (
                <label className="block flex-1">
                  <span className="text-xs font-medium">Day</span>
                  <select value={dayOfWeek} onChange={(e) => setDayOfWeek(e.target.value)} className="input">
                    {DAYS_OF_WEEK.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                  </select>
                </label>
              )}
              <label className="block flex-1">
                <span className="text-xs font-medium">Hour (UTC)</span>
                <select value={hour} onChange={(e) => setHour(e.target.value)} className="input">
                  {Array.from({ length: 24 }, (_, i) => (
                    <option key={i} value={String(i)}>{String(i).padStart(2, "0")}:00</option>
                  ))}
                </select>
              </label>
              <label className="block w-20">
                <span className="text-xs font-medium">Minute</span>
                <select value={minute} onChange={(e) => setMinute(e.target.value)} className="input">
                  {[0, 15, 30, 45].map(m => (
                    <option key={m} value={String(m)}>{String(m).padStart(2, "0")}</option>
                  ))}
                </select>
              </label>
            </div>
          )}

          {/* Task name */}
          <label className="block">
            <span className="text-xs font-medium">Task Name</span>
            <input
              value={taskName}
              onChange={(e) => setTaskName(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_"))}
              className="input font-mono"
              placeholder="SYNC_SUBMISSIONS_DAILY"
            />
          </label>

          {/* Preview */}
          <div className="text-xs text-muted-foreground bg-muted/30 rounded p-2">
            Schedule: <code>{buildSchedule(frequency, hour, minute, dayOfWeek)}</code>
          </div>

          {error && <div className="text-xs text-red-600 bg-red-50 dark:bg-red-950 rounded p-2">{error}</div>}

          <div className="flex gap-2 justify-end pt-2 border-t">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={submitting} className="btn-primary">{submitting ? "Creating..." : "Create Task"}</button>
          </div>
        </form>
      </div>
    </div>
  )
}
