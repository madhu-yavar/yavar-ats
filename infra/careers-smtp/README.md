# Careers-inbox SMTP receiver (careers.atsiq.yavar.ai)

Multi-tenant MX gateway: accepts mail for `*@careers.atsiq.yavar.ai` on :25
(mailpit, in-memory buffer), drains it to the ATSIQ inbound webhook
(`/api/public/inbound-email`, x-inbound-secret from atsiq-env) which routes
per recipient to the owning organisation. Org-agnostic — new tenants need
only their `inbox_slug` (or registered careers email), never new infrastructure.

- `careers-smtp.deployment.yaml` — mailpit + bridge (node:22-alpine,
  script from ConfigMap `careers-mail-bridge` ← bridge.mjs)
- `mailpit.lb.yaml` — public LoadBalancer, SMTP :25 only (UI/API port was
  removed deliberately: mailpit has no auth and holds candidate CVs)
- `bridge.mjs` — the drain script

## DNS (zone owner of yavar.ai)

    mx.careers.atsiq.yavar.ai.  A     35.244.23.133
    careers.atsiq.yavar.ai.     MX 10 mx.careers.atsiq.yavar.ai.
    careers.atsiq.yavar.ai.     TXT   "v=spf1 -all"

## Known v1 limits

- mailpit holds messages in memory (≤500, 48h) — a receiver restart loses
  undelivered mail; the bridge drains every 15s so the window is small.
- No TLS (plain MX-to-MX is standard), no spam filtering — non-CV mail is
  skipped gracefully by the webhook.
- Single replica: two instances would double-file messages (dedupe exists on
  provider_message_id, but keep it at 1 until persistence is added).
