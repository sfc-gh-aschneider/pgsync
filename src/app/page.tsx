import { querySnowflake } from "@/lib/snowflake"
export const dynamic = "force-dynamic"

export default async function DashboardPage() {
  const [instances, dataConfigs, roleConfigs, userConfigs, recentHistory] = await Promise.all([
    querySnowflake("SELECT * FROM PGSYNC_DB.METADATA.SYNC_INSTANCES"),
    querySnowflake("SELECT * FROM PGSYNC_DB.METADATA.SYNC_CONFIG_DATA WHERE ENABLED = TRUE"),
    querySnowflake("SELECT * FROM PGSYNC_DB.METADATA.SYNC_CONFIG_ROLES WHERE ENABLED = TRUE"),
    querySnowflake("SELECT * FROM PGSYNC_DB.METADATA.SYNC_CONFIG_USERS WHERE ENABLED = TRUE"),
    querySnowflake("SELECT SYNC_TYPE, DIRECTION, STATUS, SOURCE_OBJECT, TARGET_OBJECT, ROWS_INSERTED, DURATION_SECONDS, ERROR_MESSAGE, CREATED_AT FROM PGSYNC_DB.METADATA.SYNC_HISTORY ORDER BY CREATED_AT DESC LIMIT 10"),
  ])

  const successes = recentHistory.filter((r: any) => r.STATUS === "SUCCESS").length
  const failures = recentHistory.filter((r: any) => r.STATUS === "FAILED").length

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Snowflake to Postgres sync management
        </p>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <MetricCard label="PG Instances" value={instances.length} />
        <MetricCard label="Data Syncs" value={dataConfigs.length} />
        <MetricCard label="Role Syncs" value={roleConfigs.length} />
        <MetricCard label="User Syncs" value={userConfigs.length} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <MetricCard label="Recent Successes" value={successes} variant="success" />
        <MetricCard label="Recent Failures" value={failures} variant={failures > 0 ? "error" : "default"} />
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-3">Recent Sync Activity</h2>
        {recentHistory.length === 0 ? (
          <p className="text-sm text-muted-foreground">No sync activity yet.</p>
        ) : (
          <div className="border rounded-md overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-2 font-medium">Type</th>
                  <th className="text-left p-2 font-medium">Direction</th>
                  <th className="text-left p-2 font-medium">Status</th>
                  <th className="text-left p-2 font-medium">Source</th>
                  <th className="text-left p-2 font-medium">Target</th>
                  <th className="text-left p-2 font-medium">Rows</th>
                  <th className="text-left p-2 font-medium">Duration</th>
                  <th className="text-left p-2 font-medium">Time</th>
                </tr>
              </thead>
              <tbody>
                {recentHistory.map((row: any, i: number) => (
                  <tr key={i} className="border-t">
                    <td className="p-2">{row.SYNC_TYPE}</td>
                    <td className="p-2">{row.DIRECTION || "-"}</td>
                    <td className="p-2">
                      <StatusBadge status={row.STATUS} />
                    </td>
                    <td className="p-2 font-mono text-xs">{row.SOURCE_OBJECT || "-"}</td>
                    <td className="p-2 font-mono text-xs">{row.TARGET_OBJECT || "-"}</td>
                    <td className="p-2">{row.ROWS_INSERTED ?? "-"}</td>
                    <td className="p-2">{row.DURATION_SECONDS ? `${row.DURATION_SECONDS}s` : "-"}</td>
                    <td className="p-2 text-xs text-muted-foreground">{new Date(row.CREATED_AT).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function MetricCard({ label, value, variant = "default" }: { label: string; value: number | string; variant?: string }) {
  const colorClass = variant === "success" ? "text-green-600" : variant === "error" ? "text-red-600" : ""
  return (
    <div className="border rounded-lg p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${colorClass}`}>{value}</p>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const cls = status === "SUCCESS" ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
    : status === "FAILED" ? "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
    : "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200"
  return <span className={`px-2 py-0.5 rounded text-xs font-medium ${cls}`}>{status}</span>
}
