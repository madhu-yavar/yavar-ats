-- 2026-10-07 — Reply routing for the conversational candidate track (Phase 1).
-- Outbound candidate mail carries a per-message token reply address
-- (reply+<token>@atsiq.yavar.ai, stored on email_outbox.reply_to); the Resend
-- receiving webhook resolves it back to this row, so candidate replies thread
-- onto the application in ATSIQ instead of a human mailbox.
-- Idempotent: re-running is a no-op.
create index if not exists email_outbox_reply_to_idx on email_outbox (reply_to);

-- Link captured replies to the application they belong to.
alter table inbox_messages add column if not exists application_id uuid;
create index if not exists inbox_messages_application_idx on inbox_messages (application_id);
