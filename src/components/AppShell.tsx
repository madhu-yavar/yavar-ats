import { Link } from "@tanstack/react-router";
import {
  BarChart3,
  Briefcase,
  Building2,
  CalendarClock,
  Database,
  Globe2,
  FileSignature,
  LayoutDashboard,
  LogOut,
  Plug,
  ShieldCheck,
  Target,
  Users, BookOpen,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { usePlatform } from "@/hooks/usePlatform";
import { Button } from "@/components/ui/button";
import { Copilot } from "@/components/Copilot";
import { NotificationBell } from "@/components/NotificationBell";
import { BrandFooter, BrandLogo } from "@/components/Brand";

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
  { to: "/organisation", label: "Organisation", icon: Building2 },
  { to: "/integrations", label: "Integrations", icon: Plug },
  { to: "/masters", label: "Master data", icon: Database },
  { to: "/help", label: "User manual", icon: BookOpen },
] as const;



export function AppShell({ children }: { children: React.ReactNode }) {
  const { isSuperUser, claimable } = usePlatform();
  const nav = [...NAV, ...(isSuperUser || claimable ? [{ to: "/platform", label: "Platform console", icon: Globe2 } as const] : [])];
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
            {nav.map(({ to, label, icon: Icon }) => (
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
        <div className="flex items-center justify-between gap-2 border-b border-border bg-card px-4 py-2">
          <Link to="/" className="flex items-center gap-3">
            <BrandLogo className="h-6" />
            <span className="hidden text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground sm:inline">
              ATSIQ
            </span>
          </Link>
          <NotificationBell />
        </div>
        <div className="flex gap-1 overflow-x-auto border-b border-border bg-card px-4 py-2 lg:hidden">
          {nav.map(({ to, label }) => (
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
        <main className="mx-auto max-w-[1400px] space-y-4 p-4 sm:p-6">{children}</main>
        <BrandFooter />
      </div>
      <Copilot />
    </div>
  );
}
