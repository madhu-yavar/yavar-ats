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

    // Each family gets a box sized by how many skills it holds, then boxes flow
    // left to right and wrap — big neighbourhoods stay legible, small ones stay tight.
    const gap = 18;
    const boxes = ordered.map(([label, list]) => {
      const side = Math.min(300, Math.max(124, 60 + Math.sqrt(list.length) * 46));
      return { label, list, side };
    });

    let cursorX = gap;
    let cursorY = gap;
    let rowH = 0;
    for (const box of boxes) {
      if (cursorX + box.side > width - gap && cursorX > gap) {
        cursorX = gap;
        cursorY += rowH + gap + 14;
        rowH = 0;
      }
      const cx = cursorX + box.side / 2;
      const cy = cursorY + box.side / 2 + 12;
      clusters.push({ label: box.label, x: cx, y: cursorY + 8, count: box.list.length });

      const sorted = box.list.slice().sort((a, b) => b.supply + b.demand - (a.supply + a.demand));
      const rings = Math.max(1, Math.ceil(Math.sqrt(sorted.length / 3)));
      sorted.forEach((n, i) => {
        const r = 5 + Math.round(((n.supply + n.demand) / maxMass) * 13);
        let ring = 0;
        let seen = 0;
        while (seen + Math.max(1, ring * 6) <= i) {
          seen += Math.max(1, ring * 6);
          ring += 1;
        }
        const inRing = i - seen;
        const slots = Math.max(1, ring * 6);
        const angle = (inRing / slots) * Math.PI * 2 + ring * 0.55;
        const radius = ring === 0 ? 0 : (ring / rings) * (box.side / 2 - 14);
        placed.push({
          ...n,
          r,
          x: cx + Math.cos(angle) * radius,
          y: cy + Math.sin(angle) * radius,
        });
      });

      rowH = Math.max(rowH, box.side + 12);
      cursorX += box.side + gap;
    }

    const contentHeight = Math.max(360, cursorY + rowH + gap);
    return { width, height: contentHeight, placed, links, clusters };
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
          {layout.clusters.map((c) => (
            <text
              key={c.label}
              x={c.x}
              y={c.y}
              textAnchor="middle"
              className="fill-muted-foreground"
              style={{ fontSize: 10, letterSpacing: 1.4, textTransform: "uppercase" }}
            >
              {`${c.label.length > 16 ? `${c.label.slice(0, 15)}…` : c.label} · ${c.count}`}
            </text>
          ))}
        </g>
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
                strokeWidth={lit ? 1.6 : Math.min(1.4, 0.3 + l.weight)}
                strokeOpacity={focus ? (lit ? 0.9 : 0.08) : 0.28}
              />
            );
          })}
        </g>
        <g>
          {layout.placed.map((n) => {
            const dim = focus ? !connected.has(n.slug) : false;
            // Labels only where they can be read: big bubbles, the focus and its neighbours.
            const label = n.r >= 11 || focus === n.slug || (focus ? connected.has(n.slug) : false);
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
                <title>{`${n.name} — ${n.supply} in pool, ${n.demand} weighted demand`}</title>
                <circle
                  r={n.r}
                  fill={fill(n)}
                  stroke={selected === n.slug ? "hsl(var(--foreground))" : "white"}
                  strokeWidth={selected === n.slug ? 2.5 : 1.2}
                />
                {label ? (
                  <text
                    y={n.r + 11}
                    textAnchor="middle"
                    className="fill-foreground"
                    style={{ fontSize: 9.5, pointerEvents: "none" }}
                  >
                    {n.name.length > 18 ? `${n.name.slice(0, 17)}…` : n.name}
                  </text>
                ) : null}
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
