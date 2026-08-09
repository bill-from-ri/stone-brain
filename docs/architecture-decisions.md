# Architecture Decisions

Running record of technical decisions for Stone Brain. Each entry is either **Decided**,
**Leaning**, or **Open**. Update as we go; don't delete superseded entries — strike them and
note what replaced them, so the reasoning survives.

---

## 1. Tenancy — Decided: multi-tenant

Stone Brain is intended for other people to use and test, not just as a single-user tool.

Consequences that ripple through everything below:

- Service-account access to Drive is off the table. Every user does a real Google OAuth flow.
- Every domain row is scoped by `user_id` (or `workspace_id` if we ever add sharing). No
  global tables except reference data.
- Google refresh tokens are per-user secrets. They must be encrypted at rest, never logged,
  and never sent to the browser.
- Google's OAuth verification requirements become a real gate on launch. See §2.

---

## 2. Google OAuth scope strategy — Open, pending spike (evidence leans to Plan B)

The scope choice is the single biggest external constraint on Phase 1, because Google
classifies broad Drive access as a **restricted scope** requiring app verification plus a
third-party CASA security assessment before it can serve more than 100 users.

Confirmed scope classifications from Google's own docs: `drive.file` is **non-sensitive**;
`drive`, `drive.readonly`, and `drive.metadata.readonly` are all **restricted**.

| Option | Verification | Ceiling | UX |
| --- | --- | --- | --- |
| `drive.file` + Picker | None (non-sensitive) | Unlimited | User picks their root folder once — exactly the flow we want |
| `drive.readonly`, Testing mode | None | 100 named test users; **refresh tokens expire after 7 days** | Users re-consent weekly |
| `drive.readonly`, verified | Verification + CASA | Unlimited | Clean, but weeks of process and likely cost |

### Research findings (2026-08-09)

Google's documentation does not answer the decisive question either way. The Picker overview
and the scope guide both describe `drive.file` as **per-file access** — "Create new Drive
files, or modify existing files, that you open with an app or that the user shares with an
app" — and neither addresses whether selecting a *folder* propagates access to its
descendants. No 2025–2026 change granting folder-wide access under `drive.file` surfaced.

Two pieces of indirect evidence point toward per-file-only:

- Drive exposes **`isAppAuthorized` as a per-file boolean**, which is the shape of an ACL
  model that tracks grants file by file, not subtree by subtree.
- The documented remedy for `The user has not granted the app {appId} {verb} access to the
  file {fileId}` is to "open the Google Drive picker and prompt the user to open the file" —
  singular, per file.

This is inference, not a result, so it is recorded as leaning rather than decided.

### The spike

[`spikes/drive-file-scope/`](../spikes/drive-file-scope/) holds a self-contained page that
answers this empirically in about twenty minutes: it requests only `drive.file`, opens the
Picker in folder-select mode, then tries to list the picked folder's children, export a
child's content, and reach the Changes API. Probe 1 succeeding while probe 2 returns zero
children is the signature of the per-file model.

It could not be run here — it needs a Google Cloud OAuth client and an interactive consent
screen, both of which require a human at a browser.

### Either outcome preserves multi-tenancy

This is the important part, and it resolves the worry that failure means falling back to a
single-user app. It does not. **Testing mode is not a shared-account mode.** Every test user
runs their own OAuth flow against their own Google account and sees only their own Drive; the
data model stays fully multi-tenant and per-user isolated. What Testing mode costs is a cap of
100 named test users (each email added by hand in the Cloud console) and 7-day refresh token
expiry forcing weekly re-consent. That is a friction ceiling, not a privacy or architecture
compromise.

- **Spike passes** → Plan A: `drive.file` + Picker. Unlimited users, no verification, no cost.
- **Spike fails** → Plan B: `drive.readonly` in Testing mode. 100 testers, weekly re-consent,
  everything else in this document unchanged.

Plan B is strictly better than the obvious alternative of having users multi-select individual
files through the Picker: that would work under `drive.file`, but documents added to Drive
later would be invisible until re-picked, which breaks §3's source-of-truth story and §4's
sync entirely. A weekly re-consent is a smaller cost than a Library that silently misses new
files.

Verification for a public launch is deferred to Phase 5. Note that while Google's verification
review is free, the CASA assessment attached to restricted scopes may not be — that needs
pricing before it is treated as an option, given §8's zero-budget constraint.

In all cases the scope sits behind a `DriveClient` interface so switching is a swap, not a
rewrite.

---

## 3. Drive as source of truth vs. the `documents` table — Decided: both, with roles split

This looked like a conflict. It isn't, once authority is split by *what* is being owned:

- **Drive owns document content and Drive-native metadata** — the prose, the title, the
  folder it lives in, `modifiedTime`, whether it's trashed. Stone Brain never writes these
  (until the Phase 4 assistant explicitly pushes a Markdown file back, which is a deliberate
  user-initiated write, not a sync).
- **Postgres owns identity and derived state** — our internal document UUID, extraction
  status, which claims came from which document, which revision those claims were extracted
  from, per-user read/verified status. Drive has nowhere to put any of this.

The `documents` table is therefore **an index and a projection, not a competing copy**. Its
only writer is the sync process. Because there is exactly one writer, there is no write
conflict to adjudicate — only staleness, which is a latency question rather than a
correctness one.

### The reason we need it regardless of sync mechanism

Claims cite a document. If that document is edited after extraction, the claims may no longer
be supported by the text — but nothing in Drive records that a claim was ever derived from it.
So each document row carries:

- `head_revision_id` — the current Drive revision, updated on every sync
- `extracted_revision_id` — the revision the current claims were derived from

When these diverge, the document is stale and its claims are flagged for re-extraction. This
is impossible to model without our own table, and it is the load-bearing argument for
keeping one. It is unrelated to how fast we sync.

---

## 4. Sync mechanism — Decided: one idempotent sync function, trigger deferred

Since Drive-vs-DB is settled as a staleness question, live-vs-manual sync stops being an
architectural fork and becomes a choice of *trigger*.

Build one function:

```
sync_root(user_id) -> SyncResult
```

Idempotent, resumable, driven by the Drive **Changes API** with a per-user stored
`startPageToken`. It reconciles the projection with Drive and advances the token.

Triggers, added in order:

1. **Phase 1** — manual "Sync Drive" button, plus an automatic call on Library load if the
   last sync is older than some threshold. Ships the feature with no extra infrastructure.
2. **Later** — a poller calling `changes.list` on an interval per connected user, pushing
   results to the client over SSE. Near-live with far less machinery than webhooks.
3. **Only if needed** — Drive push notifications (`changes.watch`). These require a public
   HTTPS webhook and the channels expire within 24 hours, so they need renewal cron. Real
   ongoing cost for marginal latency gain.

Each step reuses `sync_root` unchanged, so nothing is thrown away by starting manual. Keeping
the visible "Sync Drive" control permanently is also good product: users trust a button they
can press when they know they just changed something.

---

## 5. Library root — Decided: user picks one folder at connect time

On connecting Drive, the user selects a folder that becomes their world's root. We mirror
that folder's tree.

Follow-on decisions:

- The folder tree itself must be persisted, since the Library UI renders folder structure.
  Either a `folders` table or a self-referencing `parent_id` on a unified nodes table.
- Files moved out of the root are treated as deleted from the Library (soft-delete, so their
  claims survive and can be flagged — see §7a).
- **One world per user, for now.** The prototype's "Nevlos" subtitle stays a static label
  rather than a switcher. Carry a nullable `workspace_id` on domain rows anyway: it costs
  nothing now and is expensive to retrofit if a world switcher ever arrives.
- **No world sharing.** A world has exactly one member, so the permission model is a plain
  `user_id` check on every query. No membership table, no roles, no invitations.

---

## 6. Document metadata storage — Decided: JSONB snapshot plus promoted columns

Agreed on a JSON field, with a rule for what escapes it:

- **JSONB** holds the raw `files.get` response verbatim. Schema-free, survives Google adding
  fields, invaluable for debugging a bad sync.
- **Real columns** for anything we filter, sort, join, or index on: `user_id`,
  `drive_file_id`, `parent_id`, `name`, `mime_type`, `modified_time`, `head_revision_id`,
  `trashed`, `web_view_link`, plus our own `status`, `extracted_revision_id`, `synced_at`.

Rule of thumb: **JSONB for fidelity, columns for queries.** Unique index on
`(user_id, drive_file_id)`.

---

## 7. Document types and parsing — Decided: native Google Docs only

Phase 1 filters to `application/vnd.google-apps.document`. Slides, sheets, images, and
uploaded `.docx`/`.md` files are out of scope.

For Phase 2 text extraction there are two routes:

- **`files.export` to `text/markdown`** — one call, gives clean prose, paragraphs recoverable
  by splitting on blank lines. Covered by whichever Drive scope we land on.
- **Docs API `documents.get`** — full structural JSON with character indices, which would let
  us deep-link a citation to an exact position in the document. But it needs its own
  `documents.readonly` scope, which is *also* restricted — reintroducing the §2 verification
  problem we were trying to avoid.

**Decision:** markdown export in Phase 2. The prototype's `¶ 4` style citations are
satisfiable by paragraph index from markdown. Docs API stays in reserve for if we later want
precise in-document anchors, accepting the scope cost at that point.

---

## 7a. Vanished source documents — Decided: always surface as a conflict

When a document is deleted, trashed, or moved out of the Library root, its claims are **not**
hidden and **not** deleted. The document row is soft-deleted (`trashed` / `removed_at` set) and
every claim citing it is flagged and raised in the Conflicts view as a distinct conflict kind:
*source document no longer exists*.

The reasoning: a claim whose only evidence has vanished is precisely the kind of silent
corruption this project exists to catch. Hiding it would let unsupported assertions sit in the
graph looking canonical. This is a first-class conflict type alongside the contradictory-value
conflicts of Phase 3.

Implications:

- Claims carry their supporting quote and paragraph anchor denormalized at extraction time, so
  a flagged claim can still show what it was based on after the document is gone.
- Resolution options mirror the Phase 3 conflict UI: delete the claim, re-point it at another
  document, or accept it as unsourced (demoting `canonicity` to `draft`).
- A document that reappears — untrashed, or moved back under the root — clears the flag. Since
  the match is on Drive `file_id`, this works automatically and is a good argument for
  soft-delete over hard-delete.

This conflict type is cheap to implement and does not need to wait for Phase 3, since it
requires no contradiction detection — just a foreign key check during sync.

---

## 8. Runtime topology — Decided: Vercel (Next.js) + Cloud Run (FastAPI) + Neon Postgres

Multi-tenancy changed the answer here from the initial single-user sketch. With per-user
tokens, per-user sync state, and Phase 2 scheduled extraction jobs, the token store, the sync
worker, and the cron all want to live next to the database — which is Python's side.

**Proposed split:**

- **Next.js on Vercel** — the UI, user sessions (Auth.js), and the Google OAuth callback. It
  hands the resulting refresh token to the Python service and otherwise never touches
  Postgres.
- **FastAPI, one always-on service** — all Drive calls, sync, ontology, claims, LLM
  extraction, scheduled jobs. **Sole owner of the database.**
- **Hosted Postgres** — separate from the compute host, so we can move compute without
  migrating data.

The important constraint: **exactly one service owns the schema.** Two writers with two ORMs
means two migration systems (Drizzle and Alembic) racing on one database, which is a
genuinely painful failure mode. Alembic is the only migration tool. Next.js reaches data only
through the FastAPI API, authenticating with the Auth.js-issued JWT.

### Hosts, locked in

Budget constraint: **$0/month.** Not "cheap" — actually free, and free in a way that does not
quietly delete data or degrade into unusability. Research on current 2026 free tiers is in
§10; the conclusion:

| Layer | Choice | Why |
| --- | --- | --- |
| Frontend | **Vercel Hobby** | Free, Next.js-native, no expiry. Hobby forbids commercial use — fine while this isn't commercial |
| Backend | **Google Cloud Run** (`us-central1`) | The only genuinely perpetual free compute tier left: 2M requests, 180k vCPU-s, 360k GiB-s per month. Scales to zero |
| Database | **Neon free** | 0.5 GB, scale-to-zero, and critically: exceeding limits suspends compute but **does not delete data** |
| Cron | **Cloud Scheduler** | 3 jobs free per month, native to Cloud Run, covers Phase 2 scheduled extraction |

Cloud Run also happens to sit in the same Google Cloud project as the Drive OAuth client and
Picker API key from §2 — one console, one project, one set of credentials.

**The one catch, stated plainly:** as of 3 February 2026 Cloud Run requires a billing account
with a card attached, even to use the free tier. A card on file is not a charge, but it does
mean a runaway loop could bill real money. Mitigations, to be set up *before* the first
deploy: a budget alert at $1, `--max-instances` capped low on the service, and Cloud Run
concurrency left at its default rather than forced to 1. If a card on file is unacceptable,
the fallback is Render's free tier, accepting 30–60 second cold starts and moving Postgres
entirely to Neon (Render's own free Postgres is deleted after 30 days).

---

## 9. Open questions

- **The `drive.file` spike (§2).** The only thing blocking a final scope decision. Everything
  else in Phase 1 can be built behind the `DriveClient` interface while this is pending.
- **CASA assessment cost** for restricted scopes, if we ever pursue verification for a public
  launch. Needs pricing before Phase 5.
- **Cold start tolerance.** Cloud Run scale-to-zero means the first request after idle pays a
  container start. For a Python image this is typically a second or two, but it should be
  measured against the Library's first paint before deciding whether to keep a warm instance.

### Settled since the last revision

One world per user (§5) · no sharing, plain `user_id` scoping (§5) · vanished source documents
always surface as conflicts (§7a) · $0/month budget and the host stack (§8).

---

## 10. Reference: free-tier research (2026-08-09)

The free-hosting landscape contracted sharply over 2024–2026. Findings behind the §8 decision:

**Google Cloud Run — chosen.** 2M requests, 180,000 vCPU-seconds and 360,000 GiB-seconds per
month, perpetually free, provided the service runs in `us-central1`, `us-east1`, or
`us-west1`. Scales to zero. The free tier is shared per *billing account* across all projects,
which matters only if other things get deployed alongside. Requires a billing account with a
card as of 3 Feb 2026.

**Render — rejected, on three counts.** Free web services spin down after 15 minutes idle and
take **30–60 seconds** to wake, which is a poor first paint for the Library. Free Postgres is
**deleted 30 days after creation** (plus a 14-day grace period) — disqualifying on its own for
a project meant to accumulate a knowledge graph. Cron jobs are a paid feature (~$1/month).
Retained only as the fallback if a card on file is unacceptable, and then only for compute,
with Postgres on Neon.

**Railway — rejected.** No permanent free tier. A one-time $5 trial credit, after which the
"free" plan is 1 vCPU / 0.5 GB / 1 project / $1 monthly credit, which will not carry this
workload. Hobby is $5/month.

**Fly.io — rejected.** Free allowances were removed for new customers; new signups get a short
trial, then pay-as-you-go. Cheapest always-on app runs roughly $2–5/month.

**Vercel Python Functions — rejected.** One deploy is appealing, but it inherits serverless
timeouts, has dependency size limits, and provides no long-running worker for Phase 2
extraction. Hobby cron is also heavily restricted.

**Everything in TypeScript, no Python.** Still the least infrastructure, and worth
reconsidering if the Python service ever becomes a maintenance burden. Rejected for now
because Phase 2's model evaluation over long documents and Phase 4's agentic assistant both
land more comfortably in Python, and because Cloud Run makes the extra service free anyway.

**A plain VPS (Hetzner, DigitalOcean).** Cheapest per unit of compute at scale, but costs
money from day one and carries all the ops burden — TLS, deploys, monitoring, backups.

### Database

**Neon — chosen.** 0.5 GB storage per project, up to 100 projects, 100 CU-hours of compute per
project per month. Scales to zero and resumes quickly. The decisive property: exceeding free
limits **suspends compute without deleting data**.

**Supabase — rejected.** 500 MB and a comparable feature set, but projects are **paused after
one week of inactivity** (tightened in February 2026), restorable for 90 days and then
backup-only. For a personal project touched in bursts, a time-based degradation is exactly the
wrong failure mode; Neon's volume-based degradation is far more forgiving. Worth revisiting
only if we ever want its bundled auth.

**Summary of the trade-off:** Neon degrades on volume, Supabase degrades on time. This project
is low-volume and intermittently used, so Neon wins clearly.
