"use client"

import Image from "next/image"
import { APP_TITLE, LOGO_SRC } from "@/lib/constants"
import { ThemeToggle } from "@/components/theme-toggle"
import { useInstance } from "@/components/instance-provider"
import { Database } from "lucide-react"

export function AppHeader() {
  const { instances, selectedInstance, setSelectedInstance, loading } = useInstance()

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-background text-foreground">
      <div className="w-full px-4 h-14 flex items-center gap-3">
        {LOGO_SRC && (
          <Image
            src={LOGO_SRC}
            alt={`${APP_TITLE} logo`}
            width={36}
            height={36}
            className="shrink-0 rounded"
          />
        )}
        <span className="text-sm font-semibold tracking-tight">
          {APP_TITLE}
        </span>
        <div className="ml-auto flex items-center gap-3">
          {!loading && instances.length > 0 && (
            <div className="flex items-center gap-1.5 text-xs">
              <Database size={14} className="text-muted-foreground" />
              <select
                value={selectedInstance}
                onChange={(e) => setSelectedInstance(Number(e.target.value))}
                className="bg-muted/50 border border-border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {instances.map((i) => (
                  <option key={i.INSTANCE_ID} value={i.INSTANCE_ID}>{i.INSTANCE_NAME}</option>
                ))}
              </select>
            </div>
          )}
          <ThemeToggle />
        </div>
      </div>
    </header>
  )
}
