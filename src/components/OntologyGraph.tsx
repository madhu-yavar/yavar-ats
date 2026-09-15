import { useMemo, useState } from "react";
import { Focus, Network } from "lucide-react";

import type { OntologyEdge, OntologyNode } from "@/lib/ontology.server";

type Placed = OntologyNode & { x: number; y: number; r: number };

/** Colour by pressure: violet = comfortable, amber = tightening, red = scarce. */
function fill(n: OntologyNode) {
  if (n.status === "dormant") return "var(--ontology-dormant)";
  if (n.scarcity >= 70) return "var(--ontology-scarce)";
  if (n.scarcity >= 45) return "var(--ontology-tightening)";
  return "var(--ontology-healthy)";
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
    const clusters: Array<{
      label: string;
      x: number;
      y: number;
      count: number;
      left: number;
      top: number;
      side: number;
    }> = [];

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
      const cy = cursorY + box.side / 2 + 16;
      clusters.push({
        label: box.label,
        x: cx,
        y: cursorY + 18,
        count: box.list.length,
        left: cursorX,
        top: cursorY,
        side: box.side,
      });

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
    <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-card/95 px-4 py-3">
        <div>
          <p className="text-sm font-semibold">Enterprise skill map</p>
          <p className="text-xs text-muted-foreground">
            {layout.placed.length} priority skills across {layout.clusters.length} capability families
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-md bg-secondary px-2.5 py-1.5 text-xs text-secondary-foreground">
          {focus ? <Focus className="size-3.5 text-primary" /> : <Network className="size-3.5" />}
          {focus ? "Related skills highlighted" : "Select a bubble to trace relationships"}
        </div>
      </div>
      <div className="dotted-canvas overflow-auto">
        <svg
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          className="h-[560px] min-w-[760px] w-full"
          role="img"
          aria-label="Organisational skill ontology graph"
        >
          <g>
            {layout.clusters.map((c) => (
              <rect
                key={`zone-${c.label}`}
                x={c.left}
                y={c.top}
                width={c.side}
                height={c.side + 12}
                rx="12"
                fill="var(--ontology-zone)"
                stroke="var(--border)"
                strokeWidth="1"
              />
            ))}
          </g>
        <g>
          {layout.clusters.map((c) => (
            <text
              key={c.label}
              x={c.x}
              y={c.y}
              textAnchor="middle"
              className="fill-foreground font-semibold"
              style={{ fontSize: 10, letterSpacing: 0, textTransform: "uppercase" }}
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
                stroke={lit ? "var(--primary)" : "var(--border)"}
                strokeWidth={lit ? 2 : Math.min(1.4, 0.3 + l.weight)}
                strokeOpacity={focus ? (lit ? 0.9 : 0.06) : 0.38}
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
                {selected === n.slug ? (
                  <circle r={n.r + 6} fill="var(--accent)" stroke="var(--primary)" strokeWidth="1" />
                ) : null}
                <circle
                  r={n.r}
                  fill={fill(n)}
                  stroke={selected === n.slug ? "var(--foreground)" : "var(--card)"}
                  strokeWidth={selected === n.slug ? 2.5 : 1.5}
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
      </div>
      <div className="grid gap-3 border-t px-4 py-3 text-[11px] text-muted-foreground sm:grid-cols-[auto_1fr] sm:items-center">
        <div className="flex flex-wrap items-center gap-3">
          <Legend colour="var(--ontology-healthy)" label="Healthy" />
          <Legend colour="var(--ontology-tightening)" label="Tightening" />
          <Legend colour="var(--ontology-scarce)" label="Scarce" />
          <Legend colour="var(--ontology-dormant)" label="Dormant" />
        </div>
        <p className="sm:text-right">Larger bubbles carry more people and open-role demand. Lines show skills found together.</p>
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
