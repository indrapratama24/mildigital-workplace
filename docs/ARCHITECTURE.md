# Architecture

## Overview

```
Browser (React client components)
  │  Server Actions (zod-validated)        Route handlers (/api/files, /api/export, /api/cron)
  ▼                                          ▼
src/server/actions/*  ──►  src/server/services/*  ──►  src/lib/engine/working-days.ts (pure)
       │                       │  authz + scope checks, transactions, audit, notifications
       │                       ▼
       └──────────────►  Prisma ──► PostgreSQL (constraints, partial unique index, append-only triggers)
```

- **Pages are server components.** They call services directly with the signed-in user; every service re-checks permissions and reporting scope server-side. Client components only call Server Actions.
- **Engine** (`src/lib/engine/working-days.ts`) is pure TypeScript with no DB access. The same functions run on the server (authoritative) and in the planner for live feedback.
- **Services** (`src/server/services`) own all business rules. Mutations run in `withTx` (Serializable isolation, automatic retry on serialization conflicts).
- **Adapters** (`src/server/adapters`) isolate external integrations: email, file storage, attendance provider.

| Folder | Contents |
|---|---|
| `src/app/page.tsx` | Public home page (ATLAS-aligned visual language) |
| `src/app/(app)/*` | Authenticated app: overview (Home), calendar, internal-calendar, team-calendar, requests, approvals, delegations, compliance, company (Company Hub), directory, clients, settings, notifications, account |
| `src/server/auth` | Password hashing (bcrypt), DB sessions, page/action guards |
| `src/server/authz.ts` | Role → permission matrix, grantable permissions and presets |
| `src/lib/features.ts` | Module availability (enabled / external / coming soon) used by navigation and Home |
| `src/server/services` | org, policy, calendar, schedules, revisions, requests, workflow, approvals, attendance, compliance, files, admin, jobs, notifications, audit, settings, events, people, **clients, client-metrics, workplace, access** |
| `src/components` | UI kit (`ui/`) and app components (`app/`: planner, requests, shell) |

## Roles, levels and scope

- **Role** (`User.role`: EMPLOYEE, LEADER, HR, SUPER_ADMIN) = permissions. **Level** (`EmployeeLevel`) = which WFO policy applies. They are independent: a Principal IC has no approval rights unless they are given the Leader role and are someone's leader.
- Reporting leaders must hold an approver role (Leader/HR/Admin); cycles and self-reporting are rejected.
- **Scope:** employees see themselves; leaders see their effective direct reports (primary or secondary); HR/Admin see the whole company. Approvers assigned to a step can see that item even if reporting lines later change.
- **Peer delegates** see only dates, handover notes, tasks and the handover attachment — never the reason, leave type or documents.
- **Sensitive documents** (e.g. medical) are visible only to the owner, the approvers on that request, and HR.

## Data model

All IDs are CUIDs; every table has `createdAt`/`updatedAt` (append-only tables only `createdAt`). Calendar dates are PostgreSQL `DATE`, handled as `YYYY-MM-DD` strings in code (no timezone drift).

| Requested entity | Implementation |
|---|---|
| Users / Employees | `User` (credentials, role), `Employee` (profile), `Session` |
| Departments / Teams | `Department`, `Team` (lead, **backup approver**) |
| EmployeeTeamMemberships | `EmployeeTeamMembership` (effective-dated, primary flag) |
| EmployeeLevels | `EmployeeLevel` (→ Policy) + `EmployeeLevelAssignment` (effective-dated history) |
| ReportingRelationships | `ReportingRelationship` (PRIMARY/SECONDARY, effective-dated) |
| Policies / PolicyVersions | `Policy`, `PolicyVersion` (versioned, effective-dated, immutable once used) |
| EmployeePolicyAssignments | `EmployeePolicyAssignment` (explicit, reasoned overrides) |
| HolidayCalendars / Holidays | `HolidayCalendar`, `Holiday` (NATIONAL / CUTI_BERSAMA / COMPANY, `isObserved` override) |
| MonthlySchedules / ScheduleDays | `MonthlySchedule` (status, **policy snapshot**), `ScheduleDay` (`plannedMode` draft vs `approvedMode` official) |
| — schedule history | `ScheduleVersion` (append-only JSON snapshots on submit / approve / revision) |
| ScheduleRevisions | `ScheduleRevision` + `ScheduleRevisionItem` (per-date changes, impact JSON, exception flag) |
| AttendanceRecords | `AttendanceRecord` (mode, clock-in, verification) + `AttendanceCorrection` (append-only) |
| — exceptions | `AttendanceException` (MANDATORY_DAY_WAIVER, WFO_REDUCTION) |
| LeaveTypes | `RequestType` (category, document/delegation/reason/notice rules, half/hourly, balance, sensitivity) |
| LeaveBalances | `LeaveBalance` (entitlement + adjustment per year) |
| LeaveRequests / PermissionRequests | `Request` (one table, discriminated by `RequestType.category`) |
| DelegationAssignments | `DelegationAssignment` |
| ApprovalWorkflows / Steps / Actions | `ApprovalWorkflow`, `ApprovalStep` (assignee + **original assignee**, due date, escalation), `ApprovalAction` (append-only) |
| Notifications | `Notification` (unread state, link, dedupe key) |
| AuditLogs | `AuditLog` (append-only, before/after JSON) |
| — settings | `SystemSetting` (key/value JSON) |

**Database-level guarantees** (in the init migration):
- partial unique index: at most one `PENDING` `ApprovalWorkflow` per subject (no duplicate active approvals);
- `CHECK` constraints: WFO % 0–100, deadline day 1–28, month 1–12, request end ≥ start, no self-reporting, no self-delegation;
- triggers make `ApprovalAction`, `AuditLog`, `AttendanceCorrection`, `ScheduleVersion` append-only (UPDATE/DELETE raise);
- unique `(employeeId, idempotencyKey)` on requests and revisions; unique `(employeeId, year, month)` schedules; unique `(employeeId, date)` attendance.

## Calculation engine

```
Base scheduled days      = working weekdays in the month (default Mon–Fri)
Eligible working days    = base − observed holidays (national, company; cuti bersama per setting)
Attendance-eligible days = eligible − approved full-day leave (if policy excludes leave; default yes)
                                    − approved offsite days (only when offsite does NOT count as WFO)
Percentage minimum       = round(attendance-eligible × WFO%)       (CEIL default; ROUND/FLOOR configurable,
                                                                    integer arithmetic — no float drift)
Mandatory count          = mandatory-weekday dates that are attendance-eligible, not on leave, not waived
Effective minimum WFO    = MAX(percentage minimum − approved reductions, mandatory count)
Maximum WFH              = plannable days + offsite credit − effective minimum
```

- Conflicts are **reported, not hidden**: `MANDATORY_EXCEEDS_RATIO` (effective % shown), `POLICY_NO_FLEXIBILITY`, `LEAVE_EXCLUDED` (old → new minimum), `UNACHIEVABLE`, `EXCEPTION_APPLIED`.
- Leave is never WFH and never a violation. Half-day leave keeps the day plannable (still attendance-eligible); hourly permission doesn't change the day. Overlapping half days on one date merge into a full day.
- Offsite duty is its own status: counted as WFO (default) or neutral (excluded from the denominator).
- `generatePlan` locks mandatory days and fills the remaining minimum by always choosing the ISO week with the lowest WFO share (preferring mid-week), giving balanced weeks. *Auto-balance* keeps the employee's WFO picks.
- `computeRevisionImpact` validates changed dates (future, plannable, not already pending), computes before/after WFO, shortfall, replacement days needed and suggested replacement dates (same week first). An uncoverable shortfall or a mandatory-day change requires an **authorised exception**; approving it writes an `AttendanceException` instead of silently marking the employee compliant.
- `evaluateAttendance` uses **verified** records only. Past month → Compliant / Pending verification / Non-compliant. Current month → On track / At risk / Projected shortfall. Planned days are never counted as actual.
- Compliance is tracked as four separate signals: planning, attendance, mandatory-day and approval compliance.

## Policy resolution & history

For month *M* the policy is resolved on the 1st of *M*: explicit override → level effective that day → the policy version effective that day. When a schedule is submitted, the version is **snapshotted** on the schedule, so later policy edits or level changes never alter submitted/approved months. Drafts always follow the current applicable version. Policy edits create a new version with an effective date (the previous one is closed the day before; retroactive overlap is rejected).

## Workflows

**Monthly schedule:** Draft → (Submitted) → Pending leader approval → Approved; alternatives Changes requested / Rejected (editable again), Revision pending (while date-level revisions are open), Superseded (snapshot kinds). Approved schedules can't be edited — the service rejects it and the UI routes to a revision. Policies may disable leader approval (auto-approve on submit).

**Revision:** per-date items; only those dates change on approval; the schedule returns to Approved when no revisions remain open. Optional HR step when an exception is requested and the policy requires HR.

**Request (two layers):** optional `DELEGATE` step (peer accepts / declines / asks clarification) → `LEADER` step (approve / reject / request changes). Delegation is required/optional/bypassed per request type. Decline returns the request to the employee to pick another delegate. On approval the calendar, denominator, compliance and leave balance update immediately (they are derived), and the employee/leader are notified if replacement WFO days are now needed.

**Safety:** requester can never be an assignee; only the current assignee can decide; decisions use a conditional update so double clicks/concurrent approvers can't decide twice; duplicate submissions return the original via idempotency keys; overlapping requests are blocked (except AM+PM halves or non-overlapping hours); circular delegation and delegates on leave are rejected.

**Routing & escalation:** primary leader → secondary leader → team backup approver → leader's leader → HR fallback (leaders on full-day leave are skipped). Changing a primary leader (effective today or earlier) moves *pending* leader steps to the new leader; decided steps keep `decidedBy`, and `originalAssignee` is always retained. Overdue steps are escalated by the daily job; HR/Admin can reassign manually with a reason.

## Notifications & jobs

In-app notifications for every trigger listed in the brief, with unread counts, history and deep links. `EmailAdapter` supports `none` (default) and `console`; add a real provider in `src/server/adapters/email.ts`. `runDailyJobs` (via `POST /api/cron`, `npm run cron`, or Settings → System) sends deadline reminders (deduplicated), detects WFO shortfalls and escalates overdue approvals.

## Security

- bcrypt (cost 12) passwords; DB sessions with SHA-256-hashed tokens (secret-peppered), `HttpOnly`, `SameSite=Lax`, `Secure` in production; sessions revoked on deactivation/password change; login throttling.
- Middleware gate + server-side guards on every page, action and route; zod validation on all action inputs.
- Uploads: 5 MB limit, type detected from magic bytes (PDF/PNG/JPEG/WEBP), random storage keys outside `/public`, served only via the authorised download route with `no-store`, `nosniff` and a sandbox CSP.
- CSV export neutralises spreadsheet formula injection and is audit-logged; exports respect the viewer's scope.
- Security headers: `X-Frame-Options: DENY`, `nosniff`, referrer policy, permissions policy (no camera/mic/geolocation — no location tracking).

## Known limitations (not implemented — nothing below is presented as working)

- **Authentication** is local email + password. No SSO (Google Workspace/OIDC) yet and no self-service “forgot password” email. A Super Admin can reset a password from the person's profile: they set a temporary password (all sessions end) and the person must choose and confirm a new one at next sign-in (`User.mustChangePassword` blocks every page and action until then). Users can change their password under Account. Login throttling is in-memory (per process).
- **Email** sending: adapter interface only (`none`/`console`). Needs an SMTP/Resend/SES implementation and credentials.
- **Attendance provider** integration: interface only (`AttendanceProvider`); attendance is manual self check-in + leader/HR verification.
- **Permissions** are a code-defined matrix (shown read-only in Settings → Security); roles are assignable and selected permissions can be granted per user (Settings → Roles & access), but the matrix itself isn't editable at runtime.
- **Quarterly evaluation**: the period is configurable and the engine has `aggregatePeriod`, but dashboards evaluate and display monthly figures only.
- **WFH carry-over** flag is stored on the policy but not applied in calculations.
- **Leave balances**: yearly entitlement + manual adjustment. Request types can accrue monthly (`monthlyAccrual`: entitlement ÷ 12 at the start of each month from `Employee.fullTimeSince`) and be limited to employment statuses (`eligibleStatuses`; Annual Leave = Permanent). The balance is evaluated at the leave's start date (e.g. full-time since October → 1 day in October, 3 by December). Requests beyond the balance are allowed; the excess is flagged as unpaid leave to the employee (form) and the approver (request page). No expiry or carry-over. Approved leave can't be cancelled by the employee (HR correction / new request needed).
- **Approval chain** is fixed (peer → leader → optional HR exception step); configurable per type/policy but there is no visual workflow designer.
- **Team memberships**: the model supports multiple/secondary memberships; the UI manages the primary team only.
- **Holidays**: seeded 2026 dates must be verified against the official SKB; lunar-calendar 2027 holidays must be imported when published.
- **Testing**: business scenarios are covered by service-level integration tests on PostgreSQL plus manual browser verification; there is no automated browser (Playwright) suite.
- **Dark mode** is not implemented. Files are stored on local disk by default (replace for multi-instance deployments).

## Internal Calendar (L&D and internal events)

Centralised company calendar integrated with the directory, teams, work planner, approvals and notifications.

**Routes**

| Route | Purpose |
|---|---|
| `/internal-calendar` | Month (default) / week / agenda views, filters (category, department, team, organizer, participant, mandatory/optional, attendance mode, date range, search, show cancelled), “My events only”, summary cards, upcoming list |
| `/internal-calendar/events/new` (`?from=<id>` duplicates, `?date=`) | Create event (save draft / publish) |
| `/internal-calendar/events/[id]` | Event details (also used as notification deep link) |
| `/internal-calendar/events/[id]/edit` | Edit with scope: this occurrence / this and following / entire series |
| `/api/calendar/events/[id]/ics` | “Add to my calendar” — RFC 5545 export |
| `/settings/teams#calendar-permissions` | Calendar permissions, visibility, event categories (Super Admin) |

**Tables** — `InternalEventCategory`, `InternalEventSeries` (recurrence rule), `InternalEvent` (one row per occurrence; `isException` marks individually edited occurrences; `localDate/localEndDate` = Jakarta dates for joins with schedules), `InternalEventAssignmentRule` (ALL / DEPARTMENT / TEAM / LEVEL / EMPLOYEE, `dynamicMembership`), `InternalEventParticipant` (snapshot, unique per event+employee, `assignmentSource`, `attendanceStatus`), `InternalCalendarPermission` (exactly one of employee / team / app role — DB check), `InternalEventAuditLog` (append-only trigger), `InternalEventConflictException` (leader-approved WFH exceptions; workflow subject `EVENT_EXCEPTION`). Default categories are inserted by the migration.

**Permissions** (`src/server/services/calendar-access.ts`, all server-side)

| Calendar role | Can |
|---|---|
| Viewer | See events in scope (relevant when visibility = “assigned only”) |
| Event organizer | Create events; edit events they organise or created — within scope |
| Calendar editor | Create/edit any event whose participants are within scope |
| Calendar manager | Editor + cancel events, refresh participants; with *All* scope also categories |
| Super Admin | Everything, including granting permissions |

Scope = All / one department / one team; an event is “within scope” when every assignment rule targets that unit (company-wide and level-based events need *All*). Grants can target an employee, a team (all current members) or an application role. Participants and team leaders get **no** edit rights unless granted. Drafts are only visible to people who can edit them. Published events are visible to all employees by default (setting: *assigned only*).

**Participants** — resolved from the rules at save/publish time (snapshot, deduplicated, most specific source wins). “Refresh participants” re-resolves; rules marked *dynamic* are re-synced by the daily job.

**Recurrence** (`src/lib/engine/recurrence.ts`) — daily (optional weekday filter), weekly, monthly (same day; short months skipped), custom (every N weeks on chosen weekdays); end date ≤ 1 year, ≤ 200 occurrences. Editing *this* turns the occurrence into an exception; *following* / *series* apply to non-exception occurrences that haven't started (history is preserved); changing the rule regenerates dates — occurrences that drop out are cancelled, not deleted. Cancellation supports the same scopes.

**Holidays & off days** — the calendar shows observed holidays (national, cuti bersama per setting, company) and non-working weekdays from Settings. By default events never run on them: one-time events on such a date are rejected, recurring series skip those occurrences, and when a holiday is added/imported later (or working days / cuti bersama settings change) upcoming events on those dates are cancelled automatically (kept in history, participants notified once per series). The daily job repeats this sweep. Events can opt in with “Allow on holidays and off days” (e.g. a weekend company outing). Removing a holiday does not restore cancelled occurrences.

**Work calendar integration**
- Assigned published events appear on each day as small dots/labels (category colour; mandatory in-office = filled + building icon, mandatory = filled, optional = hollow) without changing the WFO/WFH background; clicking opens the Event Details modal.
- **Conflict** = WFH (planned, or approved when the plan is approved) on a date with a *mandatory* + *in-office required* event and no pending/approved exception. Past dates are ignored. Optional or remote-allowed events never conflict.
- Draft editing warns immediately; **submission is blocked** until each conflict is WFO or has an exception request. Revisions that turn such a day into WFH require an authorised exception (approving the revision records it).
- Approved schedules are never changed automatically: participants get one grouped “Schedule conflict” notification per series and are offered *Change date to WFO* (revision), *Select another WFH date*, or *Request an exception* (leader approval in the normal inbox).
- **Auto-generate** schedules mandatory weekdays first, then mandatory in-office event dates, then balances the remaining WFO days; warns when an event falls on leave/holidays. An event only counts as WFO when the day is actually planned/verified WFO.

**Notifications** — published, added to event, time/date changed, cancelled, conflicts, reminders (1 day / 1 hour / custom). One notification per person per operation (a recurring series never sends one per occurrence); reminders are deduplicated per event/offset. Reminders are sent by the daily job and lazily when a user opens the app (Vercel Hobby cron runs once a day — use a more frequent scheduler for exact 1-hour reminders).

**Known limitations (Internal Calendar)**
- Participant attendance status (attended/absent/excused) is stored but there is no UI to record it yet.
- Week view is a column list per day, not an hourly time grid.
- Event categories and calendar permissions are managed in Settings → Internal Calendar (`team.manage`) (calendar managers with *All* scope are allowed by the API but have no UI entry point).
- “Entire series” edits never rewrite past occurrences (by design, for history); the series rule label shows the latest rule.
- No external calendar sync beyond per-event `.ics` download.

## Team Directory & people data

- **Directory** (`/directory`) is open to every employee: name, title, ID, team, level and leader are always visible; join date & tenure, birthday, phone, email and other fields follow **Settings → Directory & privacy** (`directoryFieldVisibility` setting). Audiences: Everyone · Same team (+ leaders & HR) · Their leaders & HR · HR only. Each person always sees their own data; HR sees everything. Highlights: headcount, average tenure, new joiners, upcoming birthdays (30 days), work anniversaries, incomplete HR profiles (HR only). WFO/WFH details moved to the profile's “Employment & work arrangement” section (employee, leaders, HR).
- **`EmployeePersonalData`** (1:1 with Employee): birth date/place, phone, personal email, KTP & domicile address, NIK, NPWP, bank (name, holder, account number), marital status, dependents (→ PTKP TK/0…K/3), emergency contact.
- **Encryption**: NIK, NPWP and bank account numbers are encrypted with AES-256-GCM (`src/server/crypto.ts`, key `DATA_ENCRYPTION_KEY`, 32 bytes base64). Only the last 4 digits are stored in clear (masked display) plus an HMAC blind index of NIK for uniqueness. Full values are returned only to the employee or HR via an explicit “Show” action, which is written to the audit log; audit entries never contain plaintext numbers. **Back up the key** — without it the encrypted values are unrecoverable. Rotating the key requires a re-encryption script (not yet provided).
- **Editing**: employees self-serve phone, personal email, domicile address and emergency contact; identity, bank, family and birth data are HR-maintained. Identity, bank and family/tax fields are locked to HR-only visibility.
- CSV import accepts optional `birth_date` and `phone` columns.
- Future “team member” features can reuse `canSeeField(viewer, field, subject)` and the *Same team* audience.

## MIL Digital Workplace — Phase 1

### Navigation & feature availability
- Sidebar groups: **Workspace** (Home, My Work Calendar, Internal Calendar, Requests & Approvals, Team Calendar for leaders, Attendance & Compliance), **Organization** (Company Hub, Team Directory, Client & Portfolio), **Development & Growth** (Knowledge Hub, Performance & Growth, Collaboration Hub) and **Management** (Settings & Administration). Groups can be folded (remembered per browser); the desktop rail collapses to icons (cookie `mil_sidebar`, rendered server-side).
- `src/lib/features.ts` is the single source for module status. `coming_soon` items render muted and non-interactive with a “Soon” badge and have no routes. `external` (Knowledge Hub) opens the URL from Settings → Platform (`knowledgeHubUrl`) in a new tab; with no URL, a “Platform in development” dialog is shown. No SSO is simulated.
- Home (`/overview`) is the landing page after login: welcome, my work today (mode, next WFH, next mandatory WFO, monthly compliance — reusing the planner/attendance engine), action center (plans to submit, revisions, delegations to confirm, approvals, open requests, WFO/event conflicts, regulations to acknowledge), the next 5 assigned events, announcements, recognition and quick actions filtered by access.

### Access control
- Roles stay as before. **`PermissionGrant`** adds individual permissions on top of a role (loaded into the session; `can()` checks role ∪ grants). Grantable: `client.manage`, `client.sensitive`, `client.export`, `clientPackage.manage`, `content.manage`, `report.export`, `audit.view`. Presets: *Client / Business Manager* and *Workplace content editor*. Seniority/level never grants access.
- HR (People Ops) has `content.manage` by default; Super Admin has everything. Every page and action re-checks permissions on the server.

### Company Hub (`/company`)
- **Company 101** — `CompanyContentSection` rows (10 default sections created by the migration with empty text; empty sections are hidden). Edited in Settings → About MIL with the rich content editor (below).
- **Rich content editor** (`src/components/app/editor/rich-editor.tsx`, TipTap 2) for Company 101, regulations and announcements: paragraph/H1–H3 (⌘⌥0–3), check/ordered/bulleted lists (⌘⇧9/7/8), code block, bold/italic/underline/strike, inline code, blockquote, text colour & highlight, alignment, links, tables (rows/columns/header/merge), callouts (5 tones), 2–3 column layouts, dividers, images (upload or https URL), file cards, embeds (YouTube, Vimeo, Loom, Google Docs/Slides/Sheets/Forms/Drive/Maps-embed, Figma, Canva — anything else becomes a link card), dates and @mentions linking to profiles. Stored as TipTap JSON; `src/server/content.ts` sanitises on save (allow-listed nodes/marks, validated links/images/colours, embed iframes recomputed from the URL and sandboxed) and renders server-side HTML. Legacy Markdown bodies still render and open in the editor. Images/files inserted in content are `StoredFile.isContentAsset` and readable by any signed-in employee.
- **Regulations** — `CompanyRegulation` + `RegulationVersion` (revision history). Draft → Publish; editing a published regulation creates a new draft version while the published one stays live; published versions are never edited. Archive/restore. Optional acknowledgement per published version (`RegulationAcknowledgement`, append-only) with notifications and a Home action; admins see acknowledgement counts. Attachments (PDF/images, magic-byte checked) or a document URL.
- **Announcements** — `Announcement` + `AnnouncementAudience` (All / teams / levels / employees, using current team membership and level). Visible only when published, after `publishAt` and before `expiresAt`. Priority (normal/important/critical), optional link and attachment.
- **Recognition** — manual `EmployeeRecognition` (promotion, recognition, milestone) plus automatic birthdays/anniversaries/new joiners from the directory **respecting field visibility**, and promotions derived from level history (higher-rank level in the last 60–120 days).

### Team Directory additions
- Highlights: headcount, teams, team leads, out today; **Team leads** card (each team → its lead) and **On leave or permission** (approved requests today + next 7 days with the end date; only the category is shown, never the leave type or reason).
- Table columns: name & role, nickname, team, department, level, join date, birthday, work email, phone (privacy-restricted cells show a lock). `Employee.nickname` is self-service (and HR) and searchable.
- Profile photo (`Employee.photoId`, uploaded by the employee or HR, visible to signed-in colleagues), optional role description, department column, filters for department, role (job title) and employment status (only when the viewer may see it), and a “By team” grouping. The profile lists **assigned clients** from the same `ClientTeamAssignment` rows as the client page.

### Client & Portfolio (`/clients`)
**Identifiers**
- `ClientBrand.id` — internal primary key (stable brand ID for integrations such as ATLAS).
- **`ClientBrand.clientCode` = the user-facing “Client ID”** — the unique business identifier of a *brand* in the client directory (e.g. `MIL-CL-0001`, drawn from the Postgres sequence `client_code_seq`, or entered manually by a client manager on creation). Changing it requires `settings.manage`; the old ID moves to `ClientCodeAlias` so it can never be reused. Archived records keep their ID.
- `ClientOrganization` — optional legal/business parent (one organization → many brands).
- `ClientEngagement` — one continuous collaboration period of a brand. Inactive closes it (end = Date OFF); reactivation opens a new one; Freeze stays inside it.

**Dated history (never rewritten)**
- `ClientStatusHistory` — effective-dated periods (one open period per brand, enforced by a partial unique index; rows can't be deleted). `ClientBrand.status`/`dateOff` are a cache written in the same transaction. Status changes take an effective date (≤ today, after the current period's start) and an optional reason; Inactive requires Date OFF (last collaboration day, ≥ Date START) and starts the next day. Freeze can't follow Inactive (reactivate first).
- `ClientEngagementPackage` — effective-dated package per engagement (one open row). Package changes start today; same-day corrections overwrite.
- `ClientTeamAssignment` — role per employee per brand with start/end dates. Removal or role change closes the row (never deleted). DB guarantees: one current role per employee per client, one current Consultant 1 and one Consultant 2, max 3 current Ads Strategists (trigger, plus a row lock in the service).
- **Date START** is the first collaboration day and is never changed by reactivation (editable by client managers; it moves the first status/engagement/package rows with it).

**Period & counting rules** (`src/lib/engine/clients.ts`, `src/server/services/client-metrics.ts`)
- Period: Active → Date START to today; Inactive → Date START to Date OFF; Freeze → elapsed since Date START plus the current suspension. Detail page also shows days active / frozen / inactive.
- Counts read the status period covering the reporting date (month end, or today for the current month), so later changes don't alter past months. Active excludes Freeze unless `clientFreezeCountsAsActive`. Total = all non-archived brands that had started by that date. New = first Date START within the month (reactivations are not new).
- Service API for the future Performance module: `portfolioSummary`, `portfolioTrend`, `activeClientCount`, `newClientsBetween`, `clientStatusHistory`; read-only JSON at `GET /api/clients/metrics?month=YYYY-MM&months=12` (signed-in users).

**Access**: everyone sees brand info, status, package and team; PIC contact & internal notes only with `client.sensitive` or while assigned to the client; create/edit/status/assign/archive need `client.manage`; CSV export (`/api/clients/export`, audited, formula-injection safe) needs `client.export`; packages & rules need `clientPackage.manage`. Archive (soft delete) is for mistaken records only.

**Team change date**: when the team changes on edit, a "Team change effective from" date (≤ today, ≥ Date START) is asked; new roles start that day and removed ones end the day before.

**Portfolio highlights**: the breakdown charts (package, category, industry, sub-industry, Consultant 1, Ads Strategist, ad account) are chosen and ordered by client package admins (`clientHighlights` setting, max 6).

**Classification & ad accounts**: `ClientCategory` (Retail-Fashion, Retail-Non Fashion, B2B & Services, F&B — editable) → `ClientIndustry` → `ClientSubIndustry`. Industry/sub-industry names typed on a client are found case-insensitively or created, so they're reused by other brands; admins can rename, re-file or delete unused ones. `ClientAdAccountType` (Meta Regular, Meta CPAS Shopee, Iklanku Shopee, GMV Max TikTok, TTAM, plus any added) linked via `ClientBrandAdAccount`. Client PIC contact is split into `picPhone` and `picEmail` (for future CRM activities).

**Import / export**: `/clients/import` (client.manage) takes the template columns (`/api/clients/template` — same columns as the export): rows without a known Client ID create clients, rows with one update them (status changes are not applied by import — they need an effective date). Every row is validated first (people by work email or employee ID, package/category by name, dates as YYYY-MM-DD or DD/MM/YYYY, team rules); nothing is written while any row has errors.

**Settings**: Packages & client rules (packages are archived instead of deleted once used; Consultant-1 requirement with per-client audited exception; Freeze counting rule).

### Known limitations (Phase 1)
- No ATLAS, strategy repository, client performance or meeting-notes integration — shown as “Coming soon” on the client page.
- One primary package per engagement in the UI (the model allows more). No pricing/billing data.
- Client brand logos aren't uploaded yet (initials avatar).
- Announcements have no read receipts or email delivery; regulation acknowledgements are in-app only.
- Knowledge Hub has no SSO; it's a plain external link.
- Recognition promotions are derived from level rank increases only (title changes aren't detected).

## Annual leave policy & final approval

- **Eligibility**: Annual Leave is earned by Permanent employees from `Employee.fullTimeSince` (“Leave-eligible since” — the day they passed probation, ~3 months regular / ~6 months trainee; extended probation follows the company's decision). 1 day per month, 12 per year, counted at the leave date.
- **Notice**: 14 days (request type setting). The form starts new requests at the earliest allowed date.
- **Rules** (request types with `annualRules`; values in Settings → Leave rules, `annualLeaveRules`): one leave per year up to 10 working days; one more up to 5 with at least 30 days from the other longer leave; after that 1 day per request (single days never use a tier; order of booking doesn't matter). Max 15 calendar days off in a row, counting adjoining public holidays/cuti bersama (ordinary weekends next to the leave don't extend it). At most 20% of active employees on leave (any leave type, approved or pending) on the same date. Problems are listed in the request form and block submission.
- **Beyond the balance**: allowed, shown as unpaid leave to the employee and the approver.
- **Final approval** (Settings → Approvals): a `FINAL` workflow step after the leader for the selected request types (default: Indra, all leave types). Skipped when the final approver is the requester or already the leader; “No final approval” switches it off for new requests.
- **Year-end leftover** (`leaveYearEnd`): from `windowDays` before 31 Dec employees choose to withdraw (cash) or carry over up to `maxDays` (6). Choices are stored in `LeaveYearEndChoice`; HR sees them in Settings → Leave rules with the effective days re-checked against the 31 Dec balance. Carried days are added to next year's balance for leave starting by the end of `carryUntilMonth` (June); unused carried days expire after that. Days not traded expire at year end. Payroll for cash withdrawals is outside the app.

## Team CSV import

`/directory/import` (employee.manage) works like the client import: download the template (`/api/employees/template`, same columns as `/api/employees/export`), upload or paste, check every row, then import. A known `employee_id` updates that person (empty cells keep current values; level and leader changes apply from today; email and join date aren't changed by import); a new ID creates them (leaders may be rows in the same file). Imports can set Employee/Leader roles only. New people have no usable password until a Super Admin sets a temporary one.
