import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { CATALOGUE_MODULES, type CatalogueModule } from "@/lib/product-catalogue";

/**
 * Product catalogue, for the product owner (super admin) only. Module and capability content
 * lives in code so the catalogue is always current with the shipped product; the commercial
 * layer (tier, list price, unit, notes) is editable and stored in the database.
 */

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function requireSuperUser(context: { claims?: Record<string, unknown> | null }) {
  const raw = (context.claims?.["email"] as string | undefined) ?? null;
  const email = raw ? raw.toLowerCase() : null;
  if (!email) throw new Error("Your account has no email address.");
  const db = await admin();
  const { data } = await db
    .from("platform_admins")
    .select("id")
    .ilike("email", email)
    .maybeSingle();
  if (!data) throw new Error("Super-user access only.");
  return email;
}

export type CatalogueCommercials = {
  moduleId: string;
  tier: string;
  listPrice: number | null;
  currency: string;
  unit: string;
  notes: string;
  updatedAt: string | null;
};

export type CatalogueRow = CatalogueModule & { commercials: CatalogueCommercials };

export type CatalogueResult = {
  generatedAt: string;
  modules: CatalogueRow[];
};

/** The live catalogue: shipped modules merged with their saved commercial terms. */
export const readCatalogue = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CatalogueResult> => {
    await requireSuperUser(context);
    const db = await admin();
    const { data, error } = await db.from("product_catalogue_commercials").select("*");
    if (error) throw new Error(error.message);
    const saved = new Map((data ?? []).map((r) => [r.module_id, r]));
    return {
      generatedAt: new Date().toISOString(),
      modules: CATALOGUE_MODULES.map((m) => {
        const s = saved.get(m.id);
        return {
          ...m,
          commercials: {
            moduleId: m.id,
            tier: s?.tier ?? m.defaultTier,
            listPrice:
              s?.list_price === null || s?.list_price === undefined ? null : Number(s.list_price),
            currency: s?.currency ?? "USD",
            unit: s?.unit ?? "per user / month",
            notes: s?.notes ?? "",
            updatedAt: s?.updated_at ?? null,
          },
        };
      }),
    };
  });

/** Save the commercial terms for one module. */
export const saveCatalogueCommercials = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        moduleId: z.string().min(1),
        tier: z.string().min(1).max(40),
        listPrice: z.number().nonnegative().nullable(),
        currency: z.string().min(1).max(8),
        unit: z.string().max(60),
        notes: z.string().max(600),
      })
      .parse(d),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await requireSuperUser(context);
    if (!CATALOGUE_MODULES.some((m) => m.id === data.moduleId)) throw new Error("Unknown module.");
    const db = await admin();
    const { error } = await db.from("product_catalogue_commercials").upsert(
      {
        module_id: data.moduleId,
        tier: data.tier,
        list_price: data.listPrice,
        currency: data.currency,
        unit: data.unit,
        notes: data.notes,
        updated_at: new Date().toISOString(),
        updated_by: context.userId,
      },
      { onConflict: "module_id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });
