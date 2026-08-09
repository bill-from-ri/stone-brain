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

## 2. Google OAuth scope strategy — Decided: `drive.readonly`, Testing mode (spike failed)

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

### The spike — run 2026-08-09, FAILED

[`spikes/drive-file-scope/`](../spikes/drive-file-scope/) requests only `drive.file`, opens
the Picker in folder-select mode, then probes the picked folder. Result:

```
Token granted. Scopes actually issued: https://www.googleapis.com/auth/drive.file
Picked folder: Stone Brain  (1IRoJDfxVqRrI_iKDXPsrqft7jx_ipR5o)

[1] files.get on the folder
    HTTP 404  {"error":{"code":404,"message":"File not found: 1IRoJ...","reason":"notFound"}}

[2] files.list of children  (the decisive test)
    HTTP 200
    returned 0 child file(s)
```

**The outcome was worse than the predicted failure mode.** The hypothesis was "folder granted,
descendants invisible." What actually happened is that probe 1 **404'd on the folder itself**.
Drive returns `notFound` rather than `403` for resources an app has not been granted, so that
the app cannot probe for the existence of files it can't see. Selecting a folder in the Picker
therefore grants **nothing at all** — not the folder, not its contents.

Probe 2's `HTTP 200` with zero children follows from the same fact: the parent filter matched
nothing because, from the app's perspective, no such folder exists. Probes 3 and 4 never ran.

This confirms the per-file ACL model conclusively. `drive.file` grants are issued per file, via
explicit user selection, and a folder is not a grantable unit.

**Caveat considered and dismissed:** a Shared Drive folder would produce identical output,
because the spike does not pass `supportsAllDrives=true`. Confirmed the test folder was in My
Drive, so the result stands. Any future re-run against a Workspace account must set that
parameter first.

### Rejected alternative: app-created folder

`drive.file` covers files the app itself creates, which suggests having Stone Brain create the
Library folder. This does not work: the grant follows the *file*, not its location, so a
user-authored document moved into an app-created folder remains inaccessible. Only documents
Stone Brain itself authored would be readable, which is the opposite of the use case.

### The decision

**`drive.readonly`, publishing status Testing.** Every part of the design in this document
works unchanged under it: full folder tree, recursive mirroring, the Changes API sync in §4,
live updates. The costs are a cap of 100 named test users and 7-day refresh token expiry
forcing weekly re-consent.

Rejected in favour of it: **`drive.file` with multi-select of individual *files***. Picking
files does grant access, so this would work and would carry unlimited users with no
re-consent. But the Library would only know about documents the user explicitly added — new
documents stay invisible until re-picked. That makes Phase 1's "frontend accurately reflects
structure of user's Drive folder" false and guts §4's sync design. Weekly friction on *login*
is a smaller cost than permanent friction on the core value proposition; a Library that
silently misses documents is a worse product than one that asks you to sign in again.

Plan C is retained as the documented escape hatch if we ever need more than 100 users before
verification is in place.

**Deferred cost:** a public launch on `drive.readonly` requires Google verification plus a
CASA assessment, which may not be free. That is a Phase 5 problem, and by then we will know
whether the project warrants it.

### Testing mode preserves multi-tenancy

This is the important part, and it resolves the worry that failure means falling back to a
single-user app. It does not. **Testing mode is not a shared-account mode.** Every test user
runs their own OAuth flow against their own Google account and sees only their own Drive; the
data model stays fully multi-tenant and per-user isolated. What Testing mode costs is a cap of
100 named test users (each email added by hand in the Cloud console) and 7-day refresh token
expiry forcing weekly re-consent. That is a friction ceiling, not a privacy or architecture
compromise.

The scope sits behind a `DriveClient` interface so a future switch — to Plan C, or to a
verified `drive.readonly` at launch — is a swap rather than a rewrite.

### Consequences for Phase 1 build

- Onboarding is a plain OAuth consent followed by an **in-app folder browser** we build from
  `files.list`, not the Google Picker. With `drive.readonly` we can enumerate the user's Drive
  directly, so the Picker is no longer needed anywhere in the product. It stays a useful
  dependency to have dropped.
- Every tester's Google account must be added by hand under *OAuth consent screen → Test
  users*. Worth a note in the eventual setup docs.
- The 7-day refresh token expiry must be handled as a **first-class UI state**, not an error.
  Sync will fail with `invalid_grant` roughly weekly; the Library needs a clear "reconnect
  Drive" affordance rather than a stack trace. Build this in Phase 1 — it will be hit
  constantly during testing, and it is much cheaper than retrofitting it later.

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

## 8. Runtime topology — Decided: all-TypeScript on Vercel + Neon, no Python service

> **Superseded (2026-08-09):** an earlier revision of this section specified Next.js on Vercel
> plus a FastAPI service on Cloud Run. That split was chosen on the belief that Vercel's
> serverless limits could not carry Phase 2 extraction. Checking the actual current limits
> showed otherwise — see below. The Python service is dropped; the reasoning is kept here
> because it still applies if Phase 2 ever outgrows serverless.

### What the earlier split got right, and why it no longer applies

The Cloud Run design was driven by one correct constraint: **exactly one service must own the
schema.** Two writers with two ORMs — Drizzle from Next.js and Alembic from FastAPI — means
two migration systems racing on one database, which is a genuinely painful failure mode.

Dropping the second service dissolves that constraint entirely rather than managing it. There
is one writer, one ORM, one migration tool.

### The limits that changed the decision

| Limit | Actual value (Vercel Hobby, Aug 2026) | Verdict |
| --- | --- | --- |
| Function max duration | **300s** with Fluid Compute, on by default | Ample — one document's extraction fits comfortably |
| Cron cadence | **Once per day**, and imprecise (a 1am job fires within the 1am hour) | The one real gap |
| Cron job count | 100 per project on every plan since Jan 2026 | Not a constraint |

The 300-second ceiling was the assumption the Cloud Run split rested on, and it was wrong by a
wide margin.

### How each phase lands on serverless

- **Phase 1 sync** — short Drive I/O calls; trivially serverless. Near-live updates need no
  server-side poller: the browser polls `/api/sync` while the Library is open, which is
  precisely when freshness matters. If we later add Drive push notifications, a serverless
  endpoint is the *ideal* shape for receiving a webhook.
- **Phase 2 extraction** — "scheduled runs to file claims while we're away" is a queue drain.
  Each invocation claims one unextracted document and processes it well inside 300s. This
  decomposes into short invocations; it never needs a long-running worker.
- **Phase 4 assistant** — streaming chat over serverless is a standard pattern, and the
  Anthropic and OpenAI TypeScript SDKs are first-class.

### Closing the cron gap, for free

Hobby's once-per-day cadence is the only genuine shortfall. A **GitHub Actions scheduled
workflow** (free; cron-job.org is an equivalent alternative) calls a Vercel endpoint on a
shared secret at whatever interval we want, driving the Phase 2 queue drain and any Drive
webhook channel renewal. Vercel's own cron stays as a daily fallback.

### Hosts, locked in

Budget constraint: **$0/month.** Not "cheap" — actually free, and free in a way that does not
quietly delete data or degrade into unusability. Research on current 2026 free tiers is in
§10.

| Layer | Choice | Why |
| --- | --- | --- |
| App (UI + API) | **Vercel Hobby** | Free, Next.js-native, no expiry, 300s functions |
| Database | **Neon free** | 0.5 GB, scale-to-zero, and critically: exceeding limits suspends compute but **does not delete data** |
| Scheduling | **GitHub Actions cron** | Free, arbitrary cadence, sidesteps Hobby's daily cron limit |
| ORM / migrations | **Drizzle** | Sole owner of the schema |

**No component of this stack requires a credit card on file.** That is the decisive advantage
over the Cloud Run design, which since 3 February 2026 requires a billing account even to use
its free tier — a card on file is not a charge, but it does mean a runaway loop can bill real
money.

**The one catch, stated plainly:** Vercel Hobby prohibits commercial use. Fine while Stone
Brain isn't commercial; if that changes it is a $20/month Pro upgrade, not a re-architecture.

**What we give up:** Python's ecosystem for the Phase 2 model evaluation, and any genuinely
unbounded job. Neither appears load-bearing. If Phase 2 proves otherwise, the escape hatch is
to add a single Python service *behind* the existing API — at which point the schema-ownership
rule above comes back into force and Drizzle stays the only migration tool, with Python
reading the schema it is given.

---

## 9. Open questions

- **CASA assessment cost** for restricted scopes, needed for a public launch on
  `drive.readonly`. Needs pricing before Phase 5. This is now the main thing standing between
  a working app and an unlimited audience.
- **Neon cold starts.** Scale-to-zero means the first query after idle pays a resume. Neon
  claims this is fast, but it should be measured against the Library's first paint.
- **Whether Phase 2 extraction really fits in 300s** for the longest realistic document. If
  not, the fix is chunking within the queue drain, not a new service — but it needs measuring
  once we have real documents and a real prompt.

### Settled since the last revision

OAuth scope resolved by spike — `drive.readonly` in Testing mode (§2) · one world per user
(§5) · no sharing, plain `user_id` scoping (§5) · vanished source documents always surface as
conflicts (§7a) · $0/month budget (§8) · all-TypeScript on Vercel, Python service dropped (§8).

---

## 10. Reference: free-tier research (2026-08-09)

The free-hosting landscape contracted sharply over 2024–2026. Findings behind the §8 decision:

**Vercel Hobby — chosen, for the whole app.** 300-second functions with Fluid Compute, free
with no card required, no expiry. Cron is limited to daily cadence, worked around with GitHub
Actions (§8). Prohibits commercial use.

**Google Cloud Run — strong, but no longer needed.** 2M requests, 180,000 vCPU-seconds and
360,000 GiB-seconds per month, perpetually free in `us-central1`, `us-east1`, or `us-west1`.
Scales to zero. The free tier is shared per *billing account* across all projects. Requires a
billing account with a card as of 3 Feb 2026 — the reason it lost to Vercel once Vercel turned
out to be sufficient on its own. Still the first choice if a Python service ever becomes
necessary.

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

**Vercel Python Functions — rejected.** If we are staying inside Vercel anyway, and the
runtime limits are the same either way, a second language buys nothing. Also carries
dependency size limits.

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
