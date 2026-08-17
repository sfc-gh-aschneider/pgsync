"use client"

import { useState, useEffect } from "react"
import { Zap, Play, Pause, Trash2, Plus } from "lucide-react"

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

function CreateTaskModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ task_name: "", schedule: "60 MINUTE", sync_scope: "full", instance_id: 1 })
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create", ...form }),
    })
    setSubmitting(false)
    onCreated()
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-background border rounded-lg p-6 w-full max-w-md">
        <h2 className="text-lg font-semibold mb-4">Create Sync Task</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <label className="block"><span className="text-xs font-medium">Task Name</span><input value={form.task_name} onChange={(e) => setForm({ ...form, task_name: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_") })} className="input" placeholder="HOURLY_FULL_SYNC" /></label>
          <label className="block">
            <span className="text-xs font-medium">Schedule</span>
            <select value={form.schedule} onChange={(e) => setForm({ ...form, schedule: e.target.value })} className="input">
              <option value="5 MINUTE">Every 5 minutes</option>
              <option value="15 MINUTE">Every 15 minutes</option>
              <option value="30 MINUTE">Every 30 minutes</option>
              <option value="60 MINUTE">Every hour</option>
              <option value="USING CRON 0 */6 * * * UTC">Every 6 hours</option>
              <option value="USING CRON 0 0 * * * UTC">Daily (midnight UTC)</option>
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium">Sync Scope</span>
            <select value={form.sync_scope} onChange={(e) => setForm({ ...form, sync_scope: e.target.value })} className="input">
              <option value="full">Full (Data + Roles + Users)</option>
              <option value="data">Data Only</option>
              <option value="roles">Roles Only</option>
              <option value="users">Users Only</option>
            </select>
          </label>
          <div className="flex gap-2 justify-end pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={submitting || !form.task_name} className="btn-primary">{submitting ? "Creating..." : "Create Task"}</button>
          </div>
        </form>
      </div>
    </div>
  )
}
