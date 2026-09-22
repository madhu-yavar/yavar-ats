/**
 * Tiny PostgREST-shaped query builder backed by our own Postgres connection.
 *
 * A few reporting modules were written against the hosted REST client's
 * `.from(t).select(...).eq(...)` shape. Rather than rewrite them, this shim
 * speaks the same small dialect straight to the app's database, so there is no
 * external data API in the request path.
 *
 * Identifiers are whitelisted by regex and values are always bound as
 * parameters — nothing user-supplied is interpolated into SQL text.
 */
import { sql as pg } from "./db";

const IDENT = /^[a-z_][a-z0-9_]*$/;

function ident(name: string): string {
  const trimmed = name.trim();
  if (!IDENT.test(trimmed)) throw new Error(`Unsafe identifier: ${name}`);
  return `"${trimmed}"`;
}

function columnList(select: string): string {
  if (!select || select.trim() === "*") return "*";
  return select
    .split(",")
    .map((c) => ident(c))
    .join(", ");
}

type Result<T> = { data: T; error: { message: string } | null };

class Query<Row = Record<string, unknown>> implements PromiseLike<Result<Row[]>> {
  private cols = "*";
  private wheres: Array<{ frag: string; value: unknown }> = [];
  private orderBy: string | null = null;
  private limitTo: number | null = null;

  constructor(private readonly table: string) {}

  select(cols = "*") {
    this.cols = columnList(cols);
    return this;
  }

  eq(col: string, value: unknown) {
    this.wheres.push({ frag: `${ident(col)} = `, value });
    return this;
  }

  neq(col: string, value: unknown) {
    this.wheres.push({ frag: `${ident(col)} <> `, value });
    return this;
  }

  gte(col: string, value: unknown) {
    this.wheres.push({ frag: `${ident(col)} >= `, value });
    return this;
  }

  lte(col: string, value: unknown) {
    this.wheres.push({ frag: `${ident(col)} <= `, value });
    return this;
  }

  in(col: string, values: unknown[]) {
    this.wheres.push({ frag: `${ident(col)} = ANY(`, value: values });
    return this;
  }

  order(col: string, opts?: { ascending?: boolean }) {
    this.orderBy = `${ident(col)} ${opts?.ascending === false ? "DESC" : "ASC"}`;
    return this;
  }

  limit(n: number) {
    this.limitTo = Math.max(1, Math.floor(n));
    return this;
  }

  private async run(): Promise<Row[]> {
    let text = `SELECT ${this.cols} FROM ${ident(this.table)}`;
    const params: unknown[] = [];
    if (this.wheres.length) {
      const parts = this.wheres.map((w) => {
        params.push(w.value);
        const placeholder = `$${params.length}`;
        return w.frag.endsWith("ANY(") ? `${w.frag}${placeholder})` : `${w.frag}${placeholder}`;
      });
      text += ` WHERE ${parts.join(" AND ")}`;
    }
    if (this.orderBy) text += ` ORDER BY ${this.orderBy}`;
    if (this.limitTo !== null) text += ` LIMIT ${this.limitTo}`;
    return (await pg.unsafe(text, params as never[])) as unknown as Row[];
  }

  then<A, B = never>(
    onOk?: ((value: Result<Row[]>) => A | PromiseLike<A>) | null,
    onErr?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return this.run()
      .then((rows) => ({ data: rows, error: null }))
      .catch((e: Error) => ({ data: [] as Row[], error: { message: e.message } }))
      .then(onOk, onErr);
  }

  async maybeSingle(): Promise<Result<Row | null>> {
    try {
      const rows = await this.limit(1).run();
      return { data: rows[0] ?? null, error: null };
    } catch (e) {
      return { data: null, error: { message: (e as Error).message } };
    }
  }

  async single(): Promise<Result<Row | null>> {
    return this.maybeSingle();
  }
}

class Table {
  constructor(private readonly table: string) {}

  select(cols = "*") {
    return new Query(this.table).select(cols);
  }

  async insert(values: Record<string, unknown> | Record<string, unknown>[]): Promise<Result<null>> {
    return this.write(Array.isArray(values) ? values : [values], null);
  }

  async upsert(
    values: Record<string, unknown> | Record<string, unknown>[],
    opts?: { onConflict?: string },
  ): Promise<Result<null>> {
    return this.write(Array.isArray(values) ? values : [values], opts?.onConflict ?? null);
  }

  private async write(
    rows: Record<string, unknown>[],
    onConflict: string | null,
  ): Promise<Result<null>> {
    try {
      if (!rows.length) return { data: null, error: null };
      const cols = Object.keys(rows[0]!);
      const params: unknown[] = [];
      const tuples = rows.map(
        (row) =>
          `(${cols
            .map((c) => {
              params.push(row[c] === undefined ? null : row[c]);
              return `$${params.length}`;
            })
            .join(", ")})`,
      );
      let text =
        `INSERT INTO ${ident(this.table)} (${cols.map((c) => ident(c)).join(", ")}) ` +
        `VALUES ${tuples.join(", ")}`;
      if (onConflict) {
        const keys = onConflict.split(",").map((k) => ident(k));
        const updates = cols
          .filter((c) => !onConflict.split(",").some((k) => k.trim() === c))
          .map((c) => `${ident(c)} = EXCLUDED.${ident(c)}`);
        text += updates.length
          ? ` ON CONFLICT (${keys.join(", ")}) DO UPDATE SET ${updates.join(", ")}`
          : ` ON CONFLICT (${keys.join(", ")}) DO NOTHING`;
      }
      await pg.unsafe(text, params as never[]);
      return { data: null, error: null };
    } catch (e) {
      return { data: null, error: { message: (e as Error).message } };
    }
  }
}

/** PostgREST-shaped handle over the app's own database. */
export function restClient() {
  return {
    from: (table: string) => new Table(table),
  };
}
