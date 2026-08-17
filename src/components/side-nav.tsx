"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Database, GitBranch, Users, History, Zap, LayoutDashboard, Shield, Table, Terminal, HelpCircle, Settings } from "lucide-react"

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/data-sync", label: "Data Sync", icon: Database },
  { href: "/role-sync", label: "Role Sync", icon: GitBranch },
  { href: "/user-sync", label: "User Sync", icon: Users },
  { href: "/policies", label: "Policies", icon: Shield },
  { href: "/pg-browser", label: "PG Browser", icon: Table },
  { href: "/sql-editor", label: "SQL Editor", icon: Terminal },
  { href: "/history", label: "History", icon: History },
  { href: "/automation", label: "Automation", icon: Zap },
  { href: "/admin", label: "Admin", icon: Settings },
  { href: "/help", label: "Help", icon: HelpCircle },
]

export function SideNav() {
  const pathname = usePathname()

  return (
    <nav className="w-56 shrink-0 border-r border-border bg-muted/30 p-3 flex flex-col gap-1">
      {navItems.map((item) => {
        const isActive = pathname === item.href
        const Icon = item.icon
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
              isActive
                ? "bg-primary/10 text-primary font-medium"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <Icon size={16} />
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
