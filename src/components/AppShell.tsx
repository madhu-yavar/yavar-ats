import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  BarChart3,
  BookMarked,
  Briefcase,
  Building2,
  CalendarClock,
  Database,
  Globe2,
  Handshake,
  FileSignature,
  Inbox,
  LayoutDashboard,
  LayoutTemplate,
  PanelLeftClose,
  PanelLeftOpen,
  PhoneCall,
  Plug,
  ShieldCheck,
  Target,
  Users,
  BookOpen,
  Brain,
  Gauge,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Copilot } from "@/components/Copilot";
import { NotificationBell } from "@/components/NotificationBell";
import { AccountMenu } from "@/components/AccountMenu";
import { useNavCtx, type NavCtx } from "@/hooks/useNavCtx";
import { BrandFooter, BrandLogo } from "@/components/Brand";

/**
 * Role-scoped journey. Each item carries its own visibility predicate; groups give the
 * sidebar its sections (Sourcing / Pipeline / Intelligence / Governance). Predicates
 * mirror — never replace — the server-side role enforcement on every server function.
 */
type NavItem = {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  show: (c: NavCtx) => boolean;
};
type NavGroup = { heading: string | null; items: NavItem[] };

const NAV_GROUPS: NavGroup[] = [
  {
    heading: null,
    items: [
      { to: "/", label: "Dashboard", icon: LayoutDashboard, show: (c) => c.inOrg },
      { to: "/collaboration", label: "Team & sharing", icon: Handshake, show: (c) => c.inOrg },
    ],
  },
  {
    heading: "Pipeline",
    items: [
      { to: "/requisitions", label: "Requisitions & JD", icon: Briefcase, show: (c) => c.inOrg },
      { to: "/candidates", label: "Talent pool", icon: Users, show: (c) => c.recruiterView },
      { to: "/matching", label: "JD ↔ CV matching", icon: Target, show: (c) => c.recruiterView },
      { to: "/screening", label: "Screening calls", icon: PhoneCall, show: (c) => c.recruiterView },
      { to: "/interviews", label: "Interviews", icon: CalendarClock, show: (c) => c.recruiterView },
      { to: "/interviews/mine", label: "My interviews", icon: CalendarClock, show: (c) => c.inOrg },
      { to: "/offers", label: "Offers", icon: FileSignature, show: (c) => c.recruiterView },
    ],
  },
  {
    heading: "Sourcing",
    items: [
      { to: "/inbox", label: "Careers inbox", icon: Inbox, show: (c) => c.recruiterView },
      { to: "/ijp", label: "Internal postings", icon: Building2, show: (c) => c.recruiterView },
    ],
  },
  {
    heading: "Intelligence",
    items: [
      { to: "/reports", label: "Reports", icon: BarChart3, show: (c) => c.approver },
      { to: "/roi", label: "Return on Individual", icon: Gauge, show: (c) => c.leadership },
      { to: "/brain", label: "Talent Brain", icon: Brain, show: (c) => c.leadership },
    ],
  },
  {
    heading: "Governance",
    items: [
      { to: "/team", label: "Users & roles", icon: ShieldCheck, show: (c) => c.governance },
      { to: "/organisation", label: "Organisation", icon: Building2, show: (c) => c.isOwner },
      { to: "/integrations", label: "Integrations", icon: Plug, show: (c) => c.governance },
      { to: "/masters", label: "Master data", icon: Database, show: (c) => c.governance },
      {
        to: "/templates",
        label: "Content templates",
        icon: LayoutTemplate,
        show: (c) => c.governance,
      },
      {
        to: "/platform",
        label: "Platform console",
        icon: Globe2,
        show: (c) => c.isSuperUser || c.claimable,
      },
      {
        to: "/catalogue",
        label: "Product catalogue",
        icon: BookMarked,
        show: (c) => c.isSuperUser,
      },
    ],
  },
  {
    heading: null,
    items: [{ to: "/help", label: "User manual", icon: BookOpen, show: () => true }],
  },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const ctx = useNavCtx();
  const nav = NAV_GROUPS.flatMap((g) => g.items).filter((i) => i.show(ctx));

  // Collapsed state is remembered per browser so the choice survives reloads.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    setCollapsed(localStorage.getItem("atsiq.sidebar") === "collapsed");
  }, []);
  function toggle() {
    setCollapsed((v) => {
      const next = !v;
      localStorage.setItem("atsiq.sidebar", next ? "collapsed" : "expanded");
      return next;
    });
  }

  function renderLink({
    to,
    label,
    icon: Icon,
  }: {
    to: string;
    label: string;
    icon: typeof LayoutDashboard;
  }) {
    // /interviews must not stay highlighted while on /interviews/mine.
    const exact = to === "/" || to === "/interviews";
    return (
      <Link
        key={to}
        to={to}
        title={label}
        activeOptions={{ exact }}
        className={`flex items-center gap-3 rounded-md py-2 text-sm text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground ${
          collapsed ? "justify-center px-2" : "px-3"
        }`}
        activeProps={{
          className: `flex items-center gap-3 rounded-md py-2 text-sm bg-sidebar-accent text-sidebar-accent-foreground font-medium ${
            collapsed ? "justify-center px-2" : "px-3"
          }`,
        }}
      >
        <Icon className="size-4 shrink-0" />
        {collapsed ? null : label}
      </Link>
    );
  }

  return (
    <div className="flex min-h-screen">
      <aside
        className={`sticky top-0 hidden h-screen shrink-0 flex-col overflow-y-auto bg-sidebar text-sidebar-foreground transition-[width] duration-200 lg:flex ${
          collapsed ? "w-[68px] p-3" : "w-64 p-5"
        }`}
      >
        <div>
          <div
            className={`mb-6 flex items-center gap-2 ${collapsed ? "justify-center" : "justify-between px-1"}`}
          >
            {collapsed ? null : (
              <div className="min-w-0">
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-sidebar-primary">
                  People Excellence
                </div>
                <div className="mt-1 text-lg font-semibold">Talent Acquisition</div>
              </div>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={toggle}
              aria-label={collapsed ? "Expand menu" : "Collapse menu"}
              title={collapsed ? "Expand menu" : "Collapse menu"}
              className="shrink-0 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              {collapsed ? (
                <PanelLeftOpen className="size-4" />
              ) : (
                <PanelLeftClose className="size-4" />
              )}
            </Button>
          </div>
          <nav className="space-y-1">
            {NAV_GROUPS.map((group, gi) => {
              const items = group.items.filter((i) => i.show(ctx));
              if (!items.length) return null;
              return (
                <div key={group.heading ?? `core-${gi}`} className={group.heading ? "pt-3" : ""}>
                  {group.heading && !collapsed ? (
                    <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/40">
                      {group.heading}
                    </div>
                  ) : null}
                  <div className="space-y-1">{items.map((item) => renderLink(item))}</div>
                </div>
              );
            })}
          </nav>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2 border-b border-border bg-card px-4 py-2">
          <Link to="/" className="flex items-center gap-3">
            <BrandLogo className="h-6" />
            <span className="hidden text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground sm:inline">
              ATSIQ
            </span>
          </Link>
          <div className="flex items-center gap-1">
            <NotificationBell />
            <AccountMenu />
          </div>
        </div>
        <div className="flex gap-1 overflow-x-auto border-b border-border bg-card px-4 py-2 lg:hidden">
          {nav.map(({ to, label }) => (
            <Link
              key={to}
              to={to}
              activeOptions={{ exact: to === "/" || to === "/interviews" }}
              className="whitespace-nowrap rounded-md px-3 py-1.5 text-xs text-muted-foreground"
              activeProps={{
                className:
                  "whitespace-nowrap rounded-md px-3 py-1.5 text-xs bg-secondary font-medium",
              }}
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
