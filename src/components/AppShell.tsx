import { Link } from "@tanstack/react-router";
import {
  BarChart3,
  Briefcase,
  Building2,
  CalendarClock,
  Database,
  FileSignature,
  LayoutDashboard,
  LogOut,
  Plug,
  ShieldCheck,
  Target,
  Users,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/requisitions", label: "Requisitions & JD", icon: Briefcase },
  { to: "/ijp", label: "Internal postings", icon: Building2 },
  { to: "/candidates", label: "Talent pool", icon: Users },
  { to: "/matching", label: "JD ↔ CV matching", icon: Target },
  { to: "/interviews", label: "Interviews", icon: CalendarClock },

  { to: "/offers", label: "Offers", icon: FileSignature },
  { to: "/reports", label: "Reports", icon: BarChart3 },
  { to: "/team", label: "Users & roles", icon: ShieldCheck },
  { to: "/integrations", label: "Integrations", icon: Plug },
  { to: "/masters", label: "Master data", icon: Database },
] as const;



export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col justify-between bg-sidebar p-5 text-sidebar-foreground lg:flex">
        <div>
          <div className="mb-8 px-1">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-sidebar-primary">
              People Excellence
            </div>
            <div className="mt-1 text-lg font-semibold">Talent Acquisition</div>
          </div>
          <nav className="space-y-1">
            {NAV.map(({ to, label, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                activeOptions={{ exact: to === "/" }}
                className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                activeProps={{
                  className:
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm bg-sidebar-accent text-sidebar-accent-foreground font-medium",
                }}
              >
                <Icon className="size-4" />
                {label}
              </Link>
            ))}
          </nav>
        </div>
        <Button
          variant="ghost"
          className="justify-start text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          onClick={() => supabase.auth.signOut()}
        >
          <LogOut className="size-4" /> Sign out
        </Button>
      </aside>

      <div className="min-w-0 flex-1">
        <div className="flex gap-1 overflow-x-auto border-b border-border bg-card px-4 py-2 lg:hidden">
          {NAV.map(({ to, label }) => (
            <Link
              key={to}
              to={to}
              activeOptions={{ exact: to === "/" }}
              className="whitespace-nowrap rounded-md px-3 py-1.5 text-xs text-muted-foreground"
              activeProps={{ className: "whitespace-nowrap rounded-md px-3 py-1.5 text-xs bg-secondary font-medium" }}
            >
              {label}
            </Link>
          ))}
        </div>
        <main className="mx-auto max-w-7xl space-y-6 p-5 sm:p-8">{children}</main>
      </div>
    </div>
  );
}
