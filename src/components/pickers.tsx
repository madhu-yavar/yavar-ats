import { useMemo, useState } from "react";
import { Check, Plus, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { MasterItem } from "@/lib/data";

/** Searchable multi-select over master items, with the ability to add a value that isn't in the library yet. */
export function TokenPicker({
  options,
  value,
  onChange,
  onCreate,
  placeholder = "Search…",
}: {
  options: MasterItem[];
  value: string[];
  onChange: (next: string[]) => void;
  onCreate?: (name: string) => Promise<void> | void;
  placeholder?: string;
}) {
  const [q, setQ] = useState("");
  const selected = new Set(value.map((v) => v.toLowerCase()));

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return options.filter((o) => (needle ? o.name.toLowerCase().includes(needle) : true)).slice(0, 60);
  }, [options, q]);

  const exact = matches.some((m) => m.name.toLowerCase() === q.trim().toLowerCase());

  function toggle(name: string) {
    if (selected.has(name.toLowerCase())) {
      onChange(value.filter((v) => v.toLowerCase() !== name.toLowerCase()));
    } else {
      onChange([...value, name]);
    }
  }

  return (
    <div className="rounded-md border bg-card">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-b p-2">
          {value.map((v) => (
            <Badge key={v} variant="secondary" className="gap-1">
              {v}
              <button type="button" onClick={() => toggle(v)} aria-label={`Remove ${v}`}>
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2 border-b p-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder}
          className="h-8 border-0 shadow-none focus-visible:ring-0"
        />
        {q.trim() && !exact && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 shrink-0 gap-1"
            onClick={async () => {
              const name = q.trim();
              await onCreate?.(name);
              if (!selected.has(name.toLowerCase())) onChange([...value, name]);
              setQ("");
            }}
          >
            <Plus className="h-3.5 w-3.5" /> Add “{q.trim()}”
          </Button>
        )}
      </div>
      <ul className="max-h-44 overflow-y-auto p-1 text-sm">
        {matches.length === 0 && <li className="px-2 py-3 text-xs text-muted-foreground">No matches in the library.</li>}
        {matches.map((o) => {
          const on = selected.has(o.name.toLowerCase());
          return (
            <li key={o.id}>
              <button
                type="button"
                onClick={() => toggle(o.name)}
                className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left hover:bg-accent"
              >
                <span>
                  {o.name}
                  {o.category && <span className="ml-2 text-xs text-muted-foreground">{o.category}</span>}
                </span>
                {on && <Check className="h-4 w-4 text-primary" />}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Single-select over master items with a free-text fallback. */
export function MasterSelect({
  options,
  value,
  onChange,
  placeholder,
}: {
  options: MasterItem[];
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
}) {
  const known = options.some((o) => o.name === value);
  return (
    <div className="space-y-1.5">
      <Select value={known ? value : ""} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.id} value={o.name}>
              {o.name}
              {o.category ? ` · ${o.category}` : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="or type a custom value"
        className="h-8 text-xs"
      />
    </div>
  );
}

/** Searchable single-select over a named list, with the ability to add a new entry inline. */
export function CreatableSelect({
  options,
  value,
  onChange,
  onCreate,
  placeholder = "Search…",
  addLabel = "Add",
}: {
  options: { id: string; name: string; category?: string | null }[];
  value: string;
  onChange: (next: string) => void;
  onCreate?: (name: string) => Promise<void> | void;
  placeholder?: string;
  addLabel?: string;
}) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return options.filter((o) => (needle ? o.name.toLowerCase().includes(needle) : true)).slice(0, 60);
  }, [options, q]);

  const exact = options.some((o) => o.name.toLowerCase() === q.trim().toLowerCase());

  return (
    <div className="rounded-md border bg-card">
      <div className="flex items-center gap-2 border-b p-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder}
          className="h-8 border-0 shadow-none focus-visible:ring-0"
        />
        {q.trim() && !exact && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 shrink-0 gap-1"
            disabled={busy}
            onClick={async () => {
              const name = q.trim();
              setBusy(true);
              try {
                await onCreate?.(name);
                onChange(name);
                setQ("");
              } finally {
                setBusy(false);
              }
            }}
          >
            <Plus className="h-3.5 w-3.5" /> {addLabel} “{q.trim()}”
          </Button>
        )}
      </div>
      <ul className="max-h-40 overflow-y-auto p-1 text-sm">
        {matches.length === 0 && <li className="px-2 py-3 text-xs text-muted-foreground">No matches yet.</li>}
        {matches.map((o) => (
          <li key={o.id}>
            <button
              type="button"
              onClick={() => onChange(o.name)}
              className={
                o.name === value
                  ? "flex w-full items-center justify-between rounded bg-primary/10 px-2 py-1.5 text-left font-semibold text-primary"
                  : "flex w-full items-center justify-between rounded px-2 py-1.5 text-left hover:bg-accent"
              }
            >
              <span>
                {o.name}
                {o.category && <span className="ml-2 text-xs text-muted-foreground">{o.category}</span>}
              </span>
              {o.name === value && <Check className="h-4 w-4 text-primary" />}
            </button>
          </li>
        ))}

      </ul>
      {value && (
        <div className="flex items-center gap-2 border-t border-primary/20 bg-primary/10 p-2 text-xs">
          <span className="font-medium text-primary">Selected</span>
          <span className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2 py-1 text-xs font-semibold text-primary-foreground">
            {value}
            <button type="button" onClick={() => onChange("")} aria-label="Clear selection">
              <X className="h-3 w-3" />
            </button>
          </span>
        </div>
      )}

    </div>
  );
}

