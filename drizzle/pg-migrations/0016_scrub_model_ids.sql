-- One-time cleanup: strip AI model ids from persisted, org-visible stage reasons
-- (e.g. "Auto-shortlisted by matching score 87/100 (gemini-2.5-flash)"). New rows
-- never contain one (autoscore writes vendor-neutral reasons now). Idempotent.
UPDATE "stage_events"
SET "reason" = regexp_replace("reason", '\s*\((gpt|gemini|claude)-[a-z0-9.\-]{2,60}\)', '', 'gi')
WHERE "reason" ~ '\((gpt|gemini|claude)-[a-z0-9.\-]{2,60}\)';
