import type { Metadata } from "next"
import type React from "react"
import { AppHeader } from "@/components/app-header"
import { SideNav } from "@/components/side-nav"
import { ThemeProvider } from "@/components/theme-provider"
import { QueryProvider } from "@/components/query-provider"
import { InstanceProvider } from "@/components/instance-provider"
import { APP_TITLE, LOGO_SRC } from "@/lib/constants"
import "./globals.css"

export const metadata: Metadata = {
  title: APP_TITLE,
  description: "Snowflake to Postgres sync management",
  icons: { icon: LOGO_SRC },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <ThemeProvider>
          <QueryProvider>
            <InstanceProvider>
              <AppHeader />
              <div className="flex h-[calc(100vh-3.5rem)]">
                <SideNav />
                <main className="flex-1 overflow-auto p-6">
                  {children}
                </main>
              </div>
            </InstanceProvider>
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
