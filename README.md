# MIL Digital Workplace

Internal platform for MIL Digital: Home dashboard, Company Hub (Company 101, regulations, announcements, recognition), Team Directory, Client & Portfolio, plus the hybrid-work features — WFO/WFH policies, monthly work plans, leave & permission requests with peer delegation, two-layer approvals, Internal Calendar, attendance verification and compliance reporting.

**Stack:** Next.js 15 (App Router, Server Actions) · TypeScript · Tailwind CSS 4 · Radix UI (shadcn-style components) · PostgreSQL · Prisma 6 · Vitest.
Timezone **Asia/Jakarta**; dates are displayed in Indonesian format (`20 Okt 2026`). UI language is English.

- Architecture, data model, rules and limitations: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (incl. **Internal Calendar** and **Workplace Phase 1**: Company Hub, Client & Portfolio, access grants)
- Calculation engine: [src/lib/engine/working-days.ts](src/lib/engine/working-days.ts)
- Schema: [prisma/schema.prisma](prisma/schema.prisma) · migration with DB-level guarantees: [prisma/migrations](prisma/migrations)

---

## Local setup

Requirements: **Node.js 20+** (tested on 24 LTS). PostgreSQL is optional locally: `npm run db:local` starts a real PostgreSQL 17 from npm (`embedded-postgres`) on port 5433.

```bash
npm install
```

```bash
cp .env.example .env
```

Edit `.env` and set `SESSION_SECRET` and `CRON_SECRET` to long random strings (`openssl rand -base64 32`).

Start the local database (keep this terminal open):

```bash
npm run db:local
```

In a second terminal, apply migrations and load sample data:

```bash
npx prisma migrate deploy
```

```bash
npm run db:seed
```

```bash
npm run dev
```

Open http://localhost:3000.

### Demo accounts (seed data, local only)

All seeded accounts use the password **`MilDigital2026!`**.

| Email | Role | Level | Notes |
|---|---|---|---|
| indra@mildigital.id | Super Admin | Manager & Leader | all settings |
| sari@mildigital.id | HR / People Ops | Manager & Leader | company scope, corrections, HR fallback approver |
| budi@mildigital.id | Leader | Manager & Leader | Performance/Data team approver |
| rina@mildigital.id | Leader | Manager & Leader | Creative team approver |
| hendra@mildigital.id | Leader | **Senior** | shows role ≠ level |
| dimas@mildigital.id | Employee | **Principal IC** | Principal is *not* an approver |
| rizky@mildigital.id | Employee | Principal IC (since 1 Sep 2026, Senior before) | Scenario E history |
| fajar@mildigital.id | Employee | Junior & Associate | "At risk" (missed check-ins), delegate for Ayu |
| ayu@mildigital.id | Employee | Senior | annual leave awaiting delegate |
| … | | | 16 employees, 5 teams |

The seed creates its workflow data **through the real services** (plans submitted and approved, a pending revision with a replacement day, a delegated leave awaiting the peer, a pending half-day permission, an approved offsite duty, a back-dated sick leave, October attendance with verified/unverified/missing check-ins).

> The seed's holiday list follows the 2026 SKB 3 Menteri as best known — **verify against the official decree** in Settings → Holidays. 2027 includes fixed-date holidays only.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on :3000 |
| `npm run build` / `npm start` | Production build / server |
| `npm run db:local` | Local PostgreSQL on :5433 (creates `mil_hybrid` and `mil_hybrid_test`) |
| `npm run db:migrate` | `prisma migrate dev` (create new migrations) |
| `npm run db:deploy` | Apply migrations (production) |
| `npm run db:seed` | **Wipes** and reseeds the database in `DATABASE_URL` |
| `npm test` | Unit + integration tests |
| `npm run test:unit` | Engine tests only (no DB) |
| `npm run test:integration` | Workflow scenarios against `TEST_DATABASE_URL` (truncated by the suite) |
| `npm run cron` | Run daily jobs once (reminders, shortfall detection, escalation) |
| `npm run lint` | Type check |

## Internal Calendar (demo data)

Seeded calendar permissions: **Sari** = Calendar manager (all), **Budi** = editor for the Growth department, **Creative Studio team** = organizers for their team, **Leaders (role)** = viewers. Indra (Super Admin) manages everything. Seeded events (demo times, clearly marked): Weekly Huddle — Resilience (every Monday), Ads Strategist Meeting — Google Ads Metrics, Weekly Performance Meeting — B2B Services, Gamification, PitchLab, ATLAS Demo — Report Generator, plus one draft. Several employees get schedule-conflict warnings (e.g. Ayu on 27 and 30 Oct).

## Workplace (demo data)

The seed adds fictional demo content (marked “Demo text”): Company 101 sections, two published regulations (one needs acknowledgement), announcements (one targeted at the Performance team), a recognition entry, and 8 fictional brands across Active / Freeze / Inactive including one reactivated client. **Budi** is a Client / Business Manager through permission grants (their role stays Leader). Knowledge Hub has no URL until set in Settings → Platform.

## Tests

- `tests/unit/engine.test.ts` — 33 tests: 50/75/80% policies, rounding, month lengths, leap years, public holidays and cuti bersama, mandatory-day conflicts, leave and the denominator, half days, offsite, exceptions, plan generation & balancing, revision impact/replacement, attendance statuses, quarterly aggregation, policy validation.
- `tests/unit/clients.test.ts` — client period, status-on-date, new-client and team rules.
- `tests/integration/workplace.test.ts` — permission grants, Client ID uniqueness/never reused, Date START/OFF and team validation, DB cap of 3 Ads Strategists, assignment history, sensitive client data, effective-dated status history & historical counts, package history/archiving, regulation drafts/revisions/acknowledgements, announcement status/schedule/expiry/audience.
- `tests/integration/workflows.test.ts` — 19 tests on PostgreSQL with "today" frozen at 2 Nov 2026: acceptance **Scenarios A–F**, two-layer approval, delegation decline & resubmission, circular delegation, unavailable delegate, overlapping requests, leader reassignment (history keeps the original approver), backup-approver fallback, unauthorized/self/double approval, duplicate & idempotent submissions, DB-level unique pending workflow, append-only history tables, historical policy versions, attendance corrections.

## Deployment (Vercel)

Live: **https://mil-hybrid-work.vercel.app** (team *MIL Digital*, project `mil-hybrid-work`, region `sin1`).

- Database: Neon Postgres (Singapore) via the Vercel Marketplace — sets `DATABASE_URL` (pooled, used by the app) and `DATABASE_URL_UNPOOLED` (direct, used by migrations).
- `vercel.json` runs `npm run vercel-build` (generate → `prisma migrate deploy` → `next build`) and a daily Vercel Cron at 00:00 UTC (07:00 WIB) on `/api/cron`.
- Files are stored in PostgreSQL (`STORAGE_DRIVER=db`) because Vercel has no persistent disk.
- Env vars set on Vercel: `SESSION_SECRET`, `CRON_SECRET`, `STORAGE_DRIVER`, `SESSION_TTL_HOURS`, `EMAIL_ADAPTER`, `UPLOAD_MAX_MB`, `APP_URL`, `DATA_ENCRYPTION_KEY` (encrypts NIK/NPWP/bank numbers — keep a backup in a password manager).
- Redeploy: `vercel deploy --prod`.

First admin (once, against the production database — you type the password; it is never stored in code):

```bash
vercel env pull .env.production.local --environment=production --yes && set -a && source .env.production.local && set +a && npm run db:bootstrap && rm .env.production.local
```

## Production notes

- Point `DATABASE_URL` at managed PostgreSQL and run `npm run db:deploy`.
- Set `NODE_ENV=production` (session cookie becomes `Secure`), strong `SESSION_SECRET`/`CRON_SECRET`, `APP_URL`.
- Schedule `POST /api/cron` daily with `Authorization: Bearer $CRON_SECRET` (e.g. 07:00 WIB).
- Replace local file storage (`UPLOAD_DIR`) with object storage — see `src/server/adapters/storage.ts`.
- Fonts: headlines use SF Pro via the system stack (Apple devices); body uses *Product Sans* if installed, otherwise **Google Sans** (its successor, loaded from Google Fonts). Product Sans and SF Pro can't be self-hosted without a licence.
