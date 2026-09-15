import { useMemo, useState } from "react";

import type { OntologyEdge, OntologyNode } from "@/lib/ontology.server";

type Placed = OntologyNode & { x: number; y: number; r: number };

/** Colour by pressure: violet = comfortable, amber = tightening, red = scarce. */
function fill(n: OntologyNode) {
  if (n.status === "dormant") return "hsl(var(--muted-foreground) / 0.35)";
  if (n.scarcity >= 70) return "hsl(0 72% 55% / 0.85)";
  if (n.scarcity >= 45) return "hsl(35 92% 52% / 0.85)";
  return "hsl(var(--primary) / 0.8)";
}

/**
 * Capability-family constellation drawn as plain SVG. Each family owns a
 * neighbourhood; inside it, skills are packed in spiral rings with the heaviest
 * (most people plus openings) at the centre, and co-occurrence links are drawn
 * between them.
 */
export function OntologyGraph({
  nodes,
  edges,
  onSelect,
  selected,
  limit = 70,
}: {
  nodes: OntologyNode[];
  edges: OntologyEdge[];
  onSelect: (slug: string) => void;
  selected: string | null;
  limit?: number;
}) {
  const [hover, setHover] = useState<string | null>(null);

  const layout = useMemo(() => {
    const width = 960;
    const height = 640;
    const top = nodes.slice(0, limit);
    const slugs = new Set(top.map((n) => n.slug));
    const links = edges.filter((e) => slugs.has(e.from) && slugs.has(e.to)).slice(0, 220);

    // Families ordered by size so the biggest neighbourhoods get the roomiest slots.
    const families = new Map<string, OntologyNode[]>();
    for (const n of top) {
      const list = families.get(n.category) ?? [];
      list.push(n);
      families.set(n.category, list);
    }
    const ordered = [...families.entries()].sort((a, b) => b[1].length - a[1].length);

    const maxMass = Math.max(1, ...top.map((n) => n.supply + n.demand));
    const placed: Placed[] = [];
    const clusters: Array<{ label: string; x: number; y: number; count: number }> = [];

    // Grid of neighbourhoods keeps everything inside the canvas at any node count.
    const cols = ordered.length <= 2 ? 1 : ordered.length <= 6 ? 3 : 4;
    const rows = Math.max(1, Math.ceil(ordered.length / cols));
    const cellW = width / cols;
    const cellH = height / rows;

    ordered.forEach(([label, list], ci) => {
      const cx = (ci % cols) * cellW + cellW / 2;
      const cy = Math.floor(ci / cols) * cellH + cellH / 2 + 6;
      clusters.push({ label, x: cx, y: cy - cellH / 2 + 16, count: list.length });

      const sorted = list.slice().sort((a, b) => b.supply + b.demand - (a.supply + a.demand));
      sorted.forEach((n, i) => {
        const r = 6 + Math.round(((n.supply + n.demand) / maxMass) * 14);
        // Spiral: ring 0 is the centre, then 6, 12, 18 slots outward.
        let ring = 0;
        let seen = 0;
        while (seen + Math.max(1, ring * 6) <= i) {
          seen += Math.max(1, ring * 6);
          ring += 1;
        }
        const inRing = i - seen;
        const slots = Math.max(1, ring * 6);
        const angle = (inRing / slots) * Math.PI * 2 + ring * 0.5;
        const spread = Math.min(cellW, cellH) / 2 - 26;
        const radius = ring === 0 ? 0 : (ring / Math.max(1, rows + 2)) * spread * 1.6;
        placed.push({
          ...n,
          r,
          x: Math.min(width - 26, Math.max(26, cx + Math.cos(angle) * radius)),
          y: Math.min(height - 26, Math.max(30, cy + Math.sin(angle) * radius)),
        });
      });
    });

    return { width, height, placed, links, clusters };
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
