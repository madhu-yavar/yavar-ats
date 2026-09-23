<!-- LOVABLE:BEGIN -->

> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

<!-- LOVABLE:END -->

<!-- SECURITY:BEGIN -->

## Security invariants (do not regress)

- Every tenant-scoped server function uses `requireOrg` / `requireRole` /
  `requireOrgOwner` / `requirePlatformAdmin` (src/lib/auth.middleware.ts), and every
  query it issues carries an explicit `eq(table.orgId, context.orgId)` predicate.
  There is no row-level security — this middleware is the only boundary.
- Client-supplied `requisitionId`s must pass `assertRequisitionInOrg`
  (src/server/guards.ts) before any insert that references them.
- Server-side fetches of user-supplied URLs go through `safeFetch` /
  `safeFetchText` (src/server/safe-fetch.ts) — never raw `fetch`.
- Untrusted text (CV, JD, profile, mail) enters AI prompts only through
  `untrusted(...)` with `INJECTION_RULES` in the system prompt; model JSON is
  zod-validated via the `schema` option of `aiJson`.
- Requisition/offer approval transitions and their trails are built
  server-side with `assertRole` — never accept status logic or trail entries
  from the client.
- Privileged actions (role grants, platform-admin and tenant operations,
  credential changes, capture rotation) must append to `audit_log` via
  `writeAudit` (src/server/audit.ts).
- Credentials at rest are stored via `encryptSecret`/`decryptSecret`
  (src/server/crypto.ts) — never plaintext.
- Public endpoints and server-fn RPCs are rate-limited in src/server.ts; do
  not add new public routes without limiter coverage.
- Security review reports live in SECURITY_AUDIT_REPORT*.md — never commit
  them while the repository is public.

<!-- SECURITY:END -->
