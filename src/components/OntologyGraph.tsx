import { useMemo, useState } from "react";

import type { OntologyEdge, OntologyNode } from "@/lib/ontology.server";

type Placed = OntologyNode & { x: number; y: number; r: number };

const CATEGORY_ANGLE: Record<string, number> = {};

function angleFor(category: string, categories: string[]) {
  if (CATEGORY_ANGLE[category] === undefined) {
    const idx = categories.indexOf(category);
    CATEGORY_ANGLE[category] = (idx / Math.max(1, categories.length)) * Math.PI * 2;
  }
  return CATEGORY_ANGLE[category]!;
}

/** Colour by pressure: violet = comfortable, amber = tightening, red = scarce. */
function fill(n: OntologyNode) {
  if (n.status === "dormant") return "hsl(var(--muted-foreground) / 0.35)";
  if (n.scarcity >= 70) return "hsl(0 72% 55% / 0.85)";
  if (n.scarcity >= 45) return "hsl(35 92% 52% / 0.85)";
  return "hsl(var(--primary) / 0.8)";
}

/**
 * Deterministic clustered force layout drawn as plain SVG — capability families sit
 * in their own neighbourhood, and co-occurrence edges pull related skills together.
 */
export function OntologyGraph({
  nodes,
  edges,
  onSelect,
  selected,
  limit = 90,
}: {
  nodes: OntologyNode[];
  edges: OntologyEdge[];
  onSelect: (slug: string) => void;
  selected: string | null;
  limit?: number;
}) {
  const [hover, setHover] = useState<string | null>(null);

  const layout = useMemo(() => {
    const width = 900;
    const height = 620;
    const top = nodes.slice(0, limit);
    const slugs = new Set(top.map((n) => n.slug));
    const links = edges.filter((e) => slugs.has(e.from) && slugs.has(e.to)).slice(0, 320);
    const categories = [...new Set(top.map((n) => n.category))].sort();

    const maxMass = Math.max(1, ...top.map((n) => n.supply + n.demand));
    const pos = new Map<string, { x: number; y: number; vx: number; vy: number; r: number }>();
    top.forEach((n, i) => {
      const a = angleFor(n.category, categories) + (i % 7) * 0.14;
      const radius = 130 + ((i * 37) % 210);
      pos.set(n.slug, {
        x: width / 2 + Math.cos(a) * radius,
        y: height / 2 + Math.sin(a) * radius,
        vx: 0,
        vy: 0,
        r: 8 + Math.round(((n.supply + n.demand) / maxMass) * 20),
      });
    });

    // A few relaxation passes: links attract, everything repels, clusters pull home.
    for (let step = 0; step < 140; step += 1) {
      for (const l of links) {
        const a = pos.get(l.from)!;
        const b = pos.get(l.to)!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.max(24, Math.hypot(dx, dy));
        const pull = ((dist - 110) / dist) * 0.02 * (0.4 + l.weight);
        a.vx += dx * pull;
        a.vy += dy * pull;
        b.vx -= dx * pull;
        b.vy -= dy * pull;
      }
      const list = [...pos.entries()];
      for (let i = 0; i < list.length; i += 1) {
        for (let j = i + 1; j < list.length; j += 1) {
          const a = list[i]![1];
          const b = list[j]![1];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const d2 = Math.max(400, dx * dx + dy * dy);
          const push = ((a.r + b.r) * 26) / d2;
          a.vx -= dx * push;
          a.vy -= dy * push;
          b.vx += dx * push;
          b.vy += dy * push;
        }
      }
      top.forEach((n, i) => {
        const p = pos.get(n.slug)!;
        const a = angleFor(n.category, categories) + (i % 7) * 0.14;
        const hx = width / 2 + Math.cos(a) * 250;
        const hy = height / 2 + Math.sin(a) * 200;
        p.vx += (hx - p.x) * 0.006;
        p.vy += (hy - p.y) * 0.006;
        p.x = Math.min(width - 40, Math.max(40, p.x + p.vx * 0.6));
        p.y = Math.min(height - 34, Math.max(34, p.y + p.vy * 0.6));
        p.vx *= 0.72;
        p.vy *= 0.72;
      });
    }

    const placed: Placed[] = top.map((n) => {
      const p = pos.get(n.slug)!;
      return { ...n, x: p.x, y: p.y, r: p.r };
    });
    return { width, height, placed, links, categories };
  }, [nodes, edges, limit]);

  const byslug = new Map(layout.placed.map((p) => [p.slug, p]));
  const focus = hover ?? selected;
  const connected = new Set<string>();
  if (focus) {
    connected.add(focus);
    for (const l of layout.links) {
      if (l.from === focus) connected.add(l.to);
      if (l.to === focus) connected.add(l.from);
    }
  }

  return (
    <div className="rounded-xl border bg-card">
      <svg
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        className="h-[520px] w-full"
        role="img"
        aria-label="Organisational skill ontology graph"
      >
        <g>
          {layout.links.map((l) => {
            const a = byslug.get(l.from);
            const b = byslug.get(l.to);
            if (!a || !b) return null;
            const lit = focus ? connected.has(l.from) && connected.has(l.to) : false;
            return (
              <line
                key={`${l.from}-${l.to}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={lit ? "hsl(var(--primary))" : "hsl(var(--border))"}
                strokeWidth={lit ? 1.6 : Math.min(2, 0.4 + l.weight)}
                strokeOpacity={focus ? (lit ? 0.9 : 0.15) : 0.5}
              />
            );
          })}
        </g>
        <g>
          {layout.placed.map((n) => {
            const dim = focus ? !connected.has(n.slug) : false;
            return (
              <g
                key={n.slug}
                transform={`translate(${n.x},${n.y})`}
                opacity={dim ? 0.25 : 1}
                onMouseEnter={() => setHover(n.slug)}
                onMouseLeave={() => setHover(null)}
                onClick={() => onSelect(n.slug)}
                className="cursor-pointer"
              >
                <circle
                  r={n.r}
                  fill={fill(n)}
                  stroke={selected === n.slug ? "hsl(var(--foreground))" : "white"}
                  strokeWidth={selected === n.slug ? 2.5 : 1.2}
                />
                <text
                  y={n.r + 12}
                  textAnchor="middle"
                  className="fill-foreground"
                  style={{ fontSize: 10, pointerEvents: "none" }}
                >
                  {n.name.length > 22 ? `${n.name.slice(0, 21)}…` : n.name}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
      <div className="flex flex-wrap items-center gap-4 border-t px-4 py-3 text-[11px] text-muted-foreground">
        <Legend colour="hsl(var(--primary) / 0.8)" label="Healthy supply" />
        <Legend colour="hsl(35 92% 52% / 0.85)" label="Tightening" />
        <Legend colour="hsl(0 72% 55% / 0.85)" label="Scarce vs demand" />
        <Legend colour="hsl(var(--muted-foreground) / 0.35)" label="Dormant" />
        <span>
          Bubble size = people + weighted openings. Lines = skills your people actually pair.
        </span>
      </div>
    </div>
  );
}

function Legend({ colour, label }: { colour: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block size-2.5 rounded-full" style={{ background: colour }} />
      {label}
    </span>
  );
}
