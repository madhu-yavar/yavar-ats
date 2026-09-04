# Jira import CSV for the ATSIQ project

Produce a single Jira-importable CSV covering the whole ATSIQ build as one epic, with stories, tasks and subtasks, descriptions, estimates and actual time spent.

## What the file contains

- **One epic**: "ATSIQ — AI Applicant Tracking Platform".
- **Stories** grouped by functional area of the product as it exists today: multi-tenant onboarding and approval, users/roles/access control, master data, requisitions and JD (incl. duplicate JD check), talent pool and CV intake/dedupe, JD↔CV matching and weighted scoring, social profiling and verification agent, candidate lifecycle and stage audit, interviews/scheduling/scorecards, offers, reports and dashboards, HR copilot, email infrastructure and notifications, branding/landing/legal pages, platform super-user console.
- **Tasks** under each story for the concrete pieces of work, and **subtasks** where the work was genuinely split (migrations, server functions, UI, verification).
- **Remaining work** included as To Do rows: server-side report aggregation and pagination, calendar free/busy two-way sync, LinkedIn publishing, sender-domain activation for auth emails, transactional merge hardening.

## Columns (Jira CSV importer)

```text
Issue Type, Issue Key, Issue ID, Parent ID, Summary, Description,
Epic Name, Epic Link, Status, Priority, Labels, Component,
Original Estimate (h), Time Spent (h), Assignee
```

- Hierarchy uses `Issue ID` / `Parent ID` so Jira links subtask → task/story → epic on import.
- `Epic Name` is set only on the epic row; `Epic Link` on stories.
- Estimates in hours; `Time Spent` filled from effort actually delivered in the codebase, `0` for To Do rows.
- Status is `Done`, `In Progress` or `To Do` based on the real state of each area.

## How it will be built

A Python script generates the CSV from a structured definition of the work breakdown, writes it to `/mnt/documents/atsiq-jira-import.csv`, then validates: every `Parent ID` resolves, issue types nest legally, no unescaped commas/newlines break rows, and estimate/actual totals roll up sensibly per story and epic. I will report the row count and totals.

Delivered as a downloadable CSV in chat — no application code is changed.
