# Careers inbox — M365 wiring runbook (mail-admin handoff)

The ATSIQ side is live on https://z-atsiq.yavar.ai and verified (auth, org
routing, CV parsing, graceful no-CV handling). What remains is pure mail
transport: mail that reaches the careers mailbox must be POSTed to the
inbound webhook as JSON.

## Addresses (already provisioned server-side)

| Address | How ATSIQ routes it |
|---|---|
| `yavar@careers.atsiq.yavar.ai` | inbox slug `yavar` → Yavar Technologies |
| `careers@yavar.ai` (the existing M365 careers mailbox) | matches the org's registered careers email |

Both land in the same place — pick whichever the flow finds easier.

## Webhook (do not change)

```
POST https://z-atsiq.yavar.ai/api/public/inbound-email
content-type: application/json
x-inbound-secret: <INBOUND_EMAIL_SECRET>       # header-first; do not use a query param
```

Fetch the secret (DevOps, kubectl admin):
`kubectl get secret atsiq-env -n atsiq -o jsonpath='{.data.INBOUND_EMAIL_SECRET}' | base64 -d`

## Payload contract (zod-validated server-side)

```json
{
  "to": "careers@yavar.ai",                    // original recipient (required)
  "from": "Name <candidate@somewhere.com>",    // required
  "subject": "Application — Senior Backend",   // optional, ≤500 chars
  "text": "plain-text body",                   // optional, ≤500k chars
  "messageId": "<unique-per-mail>",            // optional, dedupes provider retries
  "attachments": [                             // optional, ≤10 files, ≤10 MB each,
    { "filename": "cv.pdf",                    // ≤25 MB total
      "contentType": "application/pdf",
      "content": "<base64>" }
  ]
}
```

CV extensions that get parsed: pdf / docx / txt / rtf. Mail without a CV is
answered `{"status":"skipped"}` and stores nothing harmful. Responses:
`200` imported/skipped, `4xx` with a `detail` message on bad input or unknown
recipient, `401` on a missing/wrong secret.

## Power Automate flow (recommended — no code)

1. Create/confirm a shared mailbox that receives the careers mail (today:
   `careers@yavar.ai`).
2. Flow trigger: **When a new email arrives (V3)** on that mailbox, folder
   Inbox, include attachments.
3. Action **HTTP** (premium connector):
   - Method `POST`, URL `https://z-atsiq.yavar.ai/api/public/inbound-email`
   - Header `x-inbound-secret: <secret from the kubectl command above>`
   - Body JSON:
     ```json
     {
       "to": @{triggerOutputs()?['body/toRecipients']?[0]?['emailAddress']?['address']},
       "from": @{triggerOutputs()?['body/from']?['emailAddress']?['address']},
       "subject": @{triggerOutputs()?['body/subject']},
       "text": @{triggerOutputs()?['body/bodyPreview']},
       "messageId": @{triggerOutputs()?['body/internetMessageId']},
       "attachments": @[
         @{ ... }   // map each attachment: filename=name, content=contentBytes, contentType=contentType
       ]
     }
     ```
   - Configure the flow's retry policy to **off / 1 attempt** for non-2xx on
     validation errors (`4xx`), but allow retries on timeouts — `messageId`
     makes retries safe (duplicates are deduped server-side).
4. Send a test mail with a small PDF from a personal address; expected
   response `{"status":"imported", ...}`; the candidate then appears in
   Talent pool / the matching requisition.

## Notes

- Candidate PII flows through this webhook — keep the secret internal and do
  not log full payloads in the flow.
- Adding a second tenant later: set that org's `inbox_slug` (or registered
  careers email) and route by recipient — no new infrastructure.
- Rotation: `INBOUND_EMAIL_SECRET` has no overlap slot (unlike the cron
  secret); rotate by updating `atsiq-env` + restarting the deployment and
  updating the flow in the same window.
