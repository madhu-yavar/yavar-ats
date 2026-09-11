# LinkedIn Recruiter intelligent capture repair

## Goal
Replace brittle label matching with a structure-aware capture flow that behaves like a recruiter: opens each applicant, identifies the active profile, locates its attachment area, secures the real CV, captures the public profile URL and profile evidence, then files and analyses the same person.

## Changes
- Discover applicants from the Recruiter applicant list using stable profile URLs and row context, not first-line text.
- Confirm the active applicant from the profile header and canonical/public-profile links before capture.
- Search multiple human-visible CV locations in order: Highlights for this project, Attachments tab, recent activity attachment, then accessible download controls.
- Resolve icon-only download controls by attachment-row structure, file metadata, nearby Preview action and button position; verify the downloaded filename belongs to the active applicant.
- Capture and store the public LinkedIn profile URL separately from the Recruiter URL, plus richer active-profile text for social analysis.
- Add explicit per-applicant diagnostics so skipped results state which stage failed: navigation, identity, attachment discovery, download, storage, or analysis.
- Repackage the Chrome companion and verify its manifest, JavaScript syntax, ZIP contents, and application type checks.

## Technical details
- Keep all LinkedIn interaction inside the recruiter’s signed-in browser session.
- Do not create text-only candidates when a CV is required.
- Prefer DOM semantics, URLs, file extensions and section relationships; use text only as a fallback.
- Preserve human-paced navigation and the existing 40-applicant cap.
