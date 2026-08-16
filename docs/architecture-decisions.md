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

## 2. Google OAuth scope strategy — Decided: `drive.readonly`, unverified Production

The scope choice is the single biggest external constraint on Phase 1, because Google
classifies broad Drive access as a **restricted scope** requiring app verification plus a
third-party CASA security assessment before it can serve more than 100 users.

Confirmed scope classifications from Google's own docs: `drive.file` is **non-sensitive**;
`drive`, `drive.readonly`, and `drive.metadata.readonly` are all **restricted**.

| Option | Verification | Ceiling | UX | Outcome |
| --- | --- | --- | --- | --- |
| `drive.file` + Picker folder select | None (non-sensitive) | Unlimited | Pick the root folder once | **Disproved by spike** |
| `drive.file` + Picker multi-select files | None | Unlimited | Re-pick every new document | Rejected — Plan C, held in reserve |
| `drive.readonly`, unverified Production | None | 100 users | One warning screen at signup | **Chosen** |
| `drive.readonly`, verified | Verification + CASA | Unlimited | Clean | Deferred to Phase 5 |

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

This was inference rather than a result, so it was not acted on until the spike below
confirmed it. Recorded because the prediction was directionally right but understated the
failure.

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

**`drive.readonly`, publishing status "In Production", unverified.** Every part of the design
in this document works unchanged under it: full folder tree, recursive mirroring, the Changes
API sync in §4, live updates. The cost is a cap of 100 users and an "unverified app" warning
screen at signup.

**`drive.readonly` is not folder-scoped.** It grants read access to the user's *entire* Drive,
including files shared with them. Restricting Stone Brain to the chosen root folder is an
application-level policy of ours, not something OAuth enforces — which is exactly why Google
classifies the scope as restricted. Two consequences:

- The connect screen must be honest about what is being granted. Implying folder-level
  scoping would be a misrepresentation.
- The root-subtree check belongs in **one place** inside `DriveClient`, not scattered across
  call sites. A bug in folder filtering is a privacy incident, not a display glitch.

Rejected in favour of it — **Plan C**: `drive.file` with multi-select of individual *files*.
Picking files does grant access, so this would work, and it would carry unlimited users with
no verification ever. But the Library would only know about documents the user explicitly
added — new documents stay invisible until re-picked. That makes Phase 1's "frontend
accurately reflects structure of user's Drive folder" false and guts §4's sync design. A
100-user ceiling is a smaller cost than permanent friction on the core value proposition: a
Library that silently misses documents is a worse product than one with a guest list.

Plan C is retained as the documented escape hatch if we ever need more than 100 users and
verification is not viable.

**Deferred cost:** a public launch on `drive.readonly` requires Google verification plus a
CASA assessment, which may not be free. That is a Phase 5 problem, and by then we will know
whether the project warrants it.

### Publishing status: Production beats Testing, and it isn't close

The 7-day refresh token expiry attaches to the **Testing** publishing status specifically, not
to being unverified. Google's audience documentation: *"Authorizations by a test user will
expire seven days from the time of consent"* — a restriction that does not extend to
production users, verified or not.

| | Testing | Production, unverified |
| --- | --- | --- |
| Refresh token expiry | **7 days** | Normal — only on revocation or ~6 months idle |
| User cap | 100 test users | 100 users total |
| Adding users | Each email by hand in the console | Anyone can sign in |
| Friction | Weekly re-consent, forever | One "unverified app" screen at signup |

The user ceiling is 100 either way, so nothing is lost on audience. Production trades a
recurring weekly annoyance — one that *also silently kills unattended background work* — for a
single scary-looking screen users click through via *Advanced → Go to Stone Brain*.

**Practice:** stay in Testing while building, flip to Production before inviting anyone.

**Confidence note:** sources conflicted on whether the expiry follows Testing status or
unverified status; the authoritative Cloud console documentation resolved it in favour of the
former. It is a one-click setting with immediately observable behaviour, so confirm directly
when flipping rather than trusting this table.

### What token expiry actually costs

When a refresh token does expire, the next refresh returns `400 invalid_grant`. No data is
lost — Postgres is untouched, claims and sync state survive. The Drive connection goes dead
until the user completes a full OAuth consent round-trip; this is not a silent refresh.

The non-obvious cost is to **Phase 2's unattended extraction**. Scheduled claim-filling
depends on a live refresh token, so under Testing status it would stop after 7 days of the
user not visiting — precisely the window in which passive background work was supposed to be
valuable. This is the strongest argument for Production status, beyond mere convenience.

Regardless of publishing status, `invalid_grant` must be handled as a **first-class UI state**
rather than an error: tokens can always be revoked by the user, and Google expires them after
prolonged disuse. The Library needs a clear "reconnect Drive" affordance.

### Multi-tenancy is preserved either way

The spike failing does **not** mean falling back to a single-user app, and neither publishing
status is a shared-account mode. Every user runs their own OAuth flow against their own Google
account and sees only their own Drive; the data model stays fully multi-tenant and per-user
isolated. The 100-user cap is a friction ceiling, not a privacy or architecture compromise.

The scope sits behind a `DriveClient` interface so a future switch — to Plan C, or to a
verified `drive.readonly` at launch — is a swap rather than a rewrite.

### Consequences for Phase 1 build

- Onboarding is a plain OAuth consent followed by an **in-app folder browser** we build from
  `files.list`, not the Google Picker. With `drive.readonly` we can enumerate the user's Drive
  directly, so the Picker is not needed anywhere in the product — a useful dependency to have
  dropped.
- All root-subtree filtering lives in one place in `DriveClient`, per the scope note above.
- `invalid_grant` is a designed-for UI state from day one, not an error path.
- While in Testing status during development, each Google account must be added by hand under
  *OAuth consent screen → Test users*. This requirement disappears on flipping to Production.

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

Note that under the §2 decision Stone Brain holds a **read-only** grant, so "never writes" is
now enforced by Google rather than by our own discipline. See §10 for what that means for the
assistant.

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
2. ~~**Later** — a poller calling `changes.list` on an interval per connected user, pushing
   results to the client over SSE. Near-live with far less machinery than webhooks.~~
   **Superseded (2026-08-09) by §13:** the poller lives in the *browser*, not the server, and
   needs no SSE. Freshness only has value while someone is looking at the Library, and a
   server-side poller spends Drive quota on every connected user whether or not anyone is there.
3. **Only if needed** — Drive push notifications (`changes.watch`). These require a public
   HTTPS webhook and the channels expire within 24 hours, so they need renewal cron. Real
   ongoing cost for marginal latency gain.

Each step reuses `sync_root` unchanged, so nothing is thrown away by starting manual. Keeping
the visible "Sync Drive" control permanently is also good product: users trust a button they
can press when they know they just changed something.

### Two invariants that make "idempotent and resumable" true

These are mechanism rather than policy, so they belong here rather than in §13.

1. **The page token advances only inside the transaction that commits that page's writes.**
   Crash anywhere and you replay exactly one page, which is safe because every write is an
   upsert keyed on `(user_id, drive_file_id)` and every removal is idempotent. Bump the token
   outside that transaction and a crash between the two silently skips a page of changes
   forever — the failure mode is invisible, permanent, and indistinguishable from "nothing
   changed."
2. **`changes.getStartPageToken` is captured *before* the initial crawl begins, never after.**
   Any change occurring during the crawl is then replayed by the first incremental pass.
   Capturing it afterwards loses every such change permanently. This is the single most
   important ordering rule in the whole sync, and it is why `sync_state` carries both
   `start_page_token` and `pending_start_page_token`.

Note this required dropping Neon's HTTP driver for the WebSocket one: `neon-http` throws on
`db.transaction()` — it supports only non-interactive batches — so invariant 1 is
unimplementable on it. `poolQueryViaFetch` keeps simple reads on HTTP, so only transactions pay
for the socket.

---

## 5. Library root — Decided: user picks one folder at connect time

On connecting Drive, the user selects a folder that becomes their world's root. We mirror
that folder's tree.

Follow-on decisions:

- The folder tree itself must be persisted, since the Library UI renders folder structure.
  Either a `folders` table or a self-referencing `parent_id` on a unified nodes table.
- Files moved out of the root are treated as deleted from the Library (soft-delete, so their
  claims survive and can be flagged — see §7a).
- **One world per user, for now.** ~~The prototype's "Nevlos" subtitle stays a static label
  rather than a switcher.~~ **Superseded (2026-08-15):** the subtitle is gone from the shell
  entirely — nav rail, Home, and Library. The root folder is the user's own project name, not
  the product's, and repeating it under every heading was noise rather than orientation. It
  still appears where it is content rather than chrome: the Home screen's folder heading and
  the Library breadcrumb. Carry a nullable `workspace_id` on domain rows anyway: it costs
  nothing now and is expensive to retrofit if a world switcher ever arrives.
- **No world sharing.** A world has exactly one member, so the permission model is a plain
  `user_id` check on every query. No membership table, no roles, no invitations.

---

## 6. Document metadata storage — Decided: JSONB snapshot plus promoted columns

Agreed on a JSON field, with a rule for what escapes it:

- **JSONB** holds the raw `files.get` response verbatim. Schema-free, survives Google adding
  fields, invaluable for debugging a bad sync.
- **Real columns** for anything we filter, sort, join, or index on: `user_id`,
  `drive_file_id`, `parent_drive_folder_id`, `name`, `mime_type`, `modified_time`,
  ~~`head_revision_id`~~ **`drive_version`**, `trashed`, `web_view_link`, plus our own `status`,
  `extracted_revision_id`, `removed_at`, `synced_at`.

Rule of thumb: **JSONB for fidelity, columns for queries.** Unique index on
`(user_id, drive_file_id)` — which is also what makes restore-on-return free: a file moved out
of the root and back matches the same row and keeps the same `documents.id`, so Phase 2's
claims survive the round trip.

### Correction (2026-08-09): `headRevisionId` does not exist on native Google Docs

The promoted-columns list above originally specified `head_revision_id`. Google's Files
reference is explicit that it is *"only available for files with binary content in Google
Drive"* — native Workspace documents have no binary content, so the column would have been
**null on every row in our corpus**.

Replaced with **`files.version`**, a monotonically increasing counter that changes on every
server-side modification and arrives free in every `files.list` / `changes.list` response.
Confirmed empirically on the first real crawl: 46 of 46 native Docs returned a version.

`head_revision_id` remains in the schema as a nullable column, to be filled in Phase 2 from
`revisions.list` at extraction time — a real revision id is worth having *once there is an
extraction to pin it against*. The §3 staleness argument (`head` vs `extracted` diverging marks
a document stale) is unchanged in substance; only the field it reads changed.

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

### Correction (2026-08-15): the Library does not surface removed documents

Phase 1 shipped an **All / Removed** segmented filter in the Library toolbar, per folder, which
revealed soft-deleted rows in place. **Removed.** The flag on the claim is now the *only*
user-facing surface for a vanished document; nothing in the Library shows tombstones.

Three reasons, in order of weight:

1. **It surfaced the wrong object.** A soft-deleted Phase 1 row carries only Drive metadata that
   Drive itself holds more accurately. What is actually at risk when a document vanishes is the
   *claims that cite it*, and this section already routes those to Conflicts. A tombstone list
   in the Library is a second, weaker answer to a question §7a had already answered better.
2. **The per-folder framing could not express the worst case.** When a *folder* leaves the root,
   the cascade in §13 marks the folder removed too — so it drops out of `getFolderTree`, its URL
   404s, and the documents under it became unreachable from the UI entirely. The toggle failed
   precisely where the most was at stake.
3. **It was empty almost always**, and cost toolbar space, a URL parameter, and a query on every
   folder render to say so.

**What did not change:** the soft-delete itself. `removed_at` is still set by all four paths
(change-feed removal, trash, move-out cascade, reconciliation sweep), rows are still never hard
-deleted, and restore-on-return via the `(user_id, drive_file_id)` unique index still works
untouched. The mechanism is load-bearing for the claim graph; only its Library rendering is gone.

Consequently `getDocuments` and `getDocument` both filter `removed_at IS NULL`, so a stale
`?doc=` link opens nothing rather than describing a document the table beside it cannot show.

If a tombstone view is ever wanted again, it should be **library-wide** — one list across all
folders, driven off `removed_at IS NOT NULL` — which is immune to reason 2 by construction, and
belongs next to Conflicts rather than in the Library toolbar.

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
§12.

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

- **CASA assessment cost** for restricted scopes, needed only to exceed 100 users. Explicitly
  deprioritised: the stated goal is a small audience and hands-on OAuth experience, not mass
  adoption, so verification may never be needed at all. Revisit only if the 100-user cap
  actually binds.
- **Neon cold starts.** Scale-to-zero means the first query after idle pays a resume. Neon
  claims this is fast, but it should be measured against the Library's first paint.
- **Whether Phase 2 extraction really fits in 300s** for the longest realistic document. If
  not, the fix is chunking within the queue drain, not a new service — but it needs measuring
  once we have real documents and a real prompt.

### Settled since the last revision

OAuth scope resolved by spike — `drive.readonly`, unverified Production (§2) · one world per
user (§5) · no sharing, plain `user_id` scoping (§5) · vanished source documents always
surface as conflicts, and *only* as conflicts — the Library shows no tombstones (§7a) ·
$0/month budget (§8) · all-TypeScript on Vercel, Python service
dropped (§8) · assistant exports Markdown rather than writing to Drive (§10) · CASA
deprioritised, 100-user cap accepted (§9) · bring-your-own-provider for inference (§11).

---

## 10. Assistant output — Decided: copy as Markdown, no Drive writes

The Claude Design prototype's Assistant pane carries a **"Save to Drive"** button, which
presumed write access. Dropped, and replaced with **copy/download as Markdown**.

This aligns the product with the §2 read-only grant rather than fighting it. The Phase 4
description in the implementation plan — "write to Markdown files that can be applied to
Google Drive" — is satisfied by the user pasting or uploading the result themselves.

**Not a dead end.** Restoring write capability later would not require the full `drive` scope.
Adding **`drive.file`** alongside `drive.readonly` grants the ability to create new files and
manage only those the app itself created — read everything, write only our own output. Since
`drive.file` is non-sensitive, it adds nothing to the verification burden established in §2.
A deliberate, cheap, reversible decision.

---

## 11. LLM access — Decided: bring-your-own-provider

OpenRouter remains viable and is unaffected by the §8 serverless decision: it is a plain
OpenAI-compatible HTTP API, so no persistent process is needed and streaming works over
standard SSE from a Vercel function.

**Confirmed for the Phase 2 bake-off.** One API, swap a model string, compare candidates on
long documents — exactly the "evaluate different models" task in the implementation plan.

### Why a single shared key was rejected

Three constraints, researched 2026-08-09, that together ruled out running everyone's inference
through one OpenRouter account:

1. **Data policy.** `:free` endpoints require enabling *"may train on inputs"* and *"may
   publish prompts"* in OpenRouter privacy settings; without them the API returns `404 No
   endpoints found matching your data policy`. OpenRouter does not train on inputs itself, but
   the upstream providers behind free endpoints may. For the owner's own documents this is a
   personal choice; for **other users' unpublished writing it is a disclosure obligation** and
   must appear on the connect screen, not in fine print.
2. **Rate limits are per-account and shared across all tenants.** 20 requests/minute, and 50
   requests/day at a $0 balance — roughly one full extraction pass over a 34-document corpus
   per day, before retries. A one-time $10 purchase raises the daily cap to 1,000 permanently,
   but that conflicts with the §8 zero-budget constraint. With more than a couple of users,
   50/day is the binding limit on the whole product.
3. **Context windows vary** across free models, and Phase 2 targets long documents. Which free
   models can hold a full document is for the bake-off to measure, not to assume.

### The decision: users configure their own provider

Each user supplies their own inference credentials. This dissolves all three constraints above
rather than trading between them, and it is the only option that stays free *and* scales past
a single user.

**What it makes simpler:**

- **The shared ceiling disappears.** Rate limits and daily caps become per-user. Phase 2's
  unattended scheduled extraction becomes viable, which it was not on a shared 50/day bucket.
- **The data-policy obligation inverts.** Stone Brain stops being the party shipping other
  people's unpublished writing to training endpoints; the user picks a provider and accepts
  its terms. We still owe a clear statement of *what* we send, but we no longer make the
  privacy decision on their behalf.
- **Our cost is $0 permanently**, with no path where adoption starts costing money — a
  stronger guarantee than a currently-generous free tier.
- **It reuses existing machinery.** An encrypted per-user secret store is already required for
  Google refresh tokens (§1). A provider key is the same problem with the same solution: one
  secrets module, not two.

**What it costs:**

- **A second onboarding step.** Mitigated by timing — see below.
- **A second connection-health state.** Alongside Drive's `invalid_grant`: missing key,
  revoked key (401), out of credit (402), rate limited (429). These are designed UI states,
  not error paths, and share a "connection status" pattern with §2's reconnect affordance.

### Design consequences of not controlling the model

- **Structured output cannot depend on any one provider's features.** Claim extraction needs
  JSON-schema prompting plus validation plus retry, written to hold across models rather than
  tuned to one. Materially different from targeting a single API.
- **Claims record their origin model.** An `extracted_by_model` column on the claim row:
  provenance for debugging, and the basis for deciding what to re-extract when a user moves
  from a weak model to a strong one.

### Configuration shape

Store **base URL + API key + model ID** rather than an OpenRouter key specifically. Accepting
any OpenAI-compatible endpoint is barely more work than hardcoding one provider and covers
OpenRouter, most hosted providers, and local runtimes. Providers whose native request shape
differs would need their own adapter — add only on request.

Keys never reach the browser; all inference proxies through the server, same rule as Google
tokens in §1.

### Timing: this does not touch Phase 1

**Phase 1 requires no LLM at all** — Library, Drive sync, and folder mirroring are entirely
LLM-free. So the app must work fully with no provider configured, and the key is requested
only when the user first attempts claim extraction. Progressive disclosure rather than a
second barrier at signup.

The Phase 2 bake-off changes purpose accordingly: from "pick the model" to "confirm the
extraction prompt holds across a range of models, and publish a recommended default." Its
output is a docs page, not a hardcoded constant.

---

## 12. Reference: free-tier research (2026-08-09)

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

---

## 13. Live updates — Decided: visibility-aware browser polling

Phase 1's fourth checkbox was "ideally we can get live updates; manually syncing with Drive is
friction I want to avoid." This is how that is delivered, and what it costs.

### The decision

The browser polls `POST /api/sync` **every 20 seconds while the Library is mounted *and*
`document.visibilityState === 'visible'`**, plus once on mount, once on becoming visible again,
and on demand via a permanent "Sync Drive" button. During the first crawl the cadence drops to
2 seconds so indexing progress animates. No server-side poller, no SSE, no webhooks in Phase 1.

Practical freshness is therefore **~20 seconds** with the tab open, and immediate on demand.

### Why the browser and not the server

Freshness only has value while someone is looking at the Library. A server-side poller spends
Drive quota on every connected user whether or not anyone is present, and Vercel Hobby cron
cannot go finer than daily anyway (§8).

**The Page Visibility gate is what makes the cost bounded**, and it is not a nicety: without it
a forgotten tab polls forever. With it, a backgrounded tab costs nothing.

### Why not SSE, and why not `changes.watch`

SSE would add a long-lived connection to move ~20s to ~1s, which nobody asked for — and on
Vercel the function still polls `changes.list` and dies at 300s, forcing reconnects. More
machinery for the same actual latency.

`changes.watch` gives true push, but needs a public HTTPS webhook and channels that expire
inside 24 hours, meaning a renewal cron — real ongoing infrastructure. Both remain available
later, and both reuse `sync_root` unchanged, which was the point of §4's design.

### Quota arithmetic

20s polling with a visible tab is **180 requests/hour/user** — measured at **one
`changes.list` call per tick** when nothing has changed. 100 users all with tabs open is ~300
requests/minute against Drive's ~12,000/minute project quota. Not close.

### Concurrency: a lease column, not an advisory lock

Two browser tabs polling at once is the common case, not the edge case.

`pg_advisory_lock` is session-scoped, and holding a Postgres session — or worse, a transaction
— open across many seconds of external HTTP I/O to Google is exactly what you must not do
against a scale-to-zero instance with connection limits. Instead `sync_state` carries
`lock_token` / `lock_acquired_at`, and acquisition is a single `UPDATE … WHERE lock_acquired_at
IS NULL OR lock_acquired_at < now() - interval '5 minutes'`. It survives process death via the
timeout, works across tabs, deploys and regions, and is renewed during long crawls so a
slow-but-healthy run is not stolen. A losing caller receives `{running: true}` and **HTTP 200**,
not an error.

### The folder-move problem — recorded here because it is the likeliest future regression

`changes.list` reports **one** event when a folder moves, but the scope of its entire subtree
changes and Drive will never enumerate the descendants for us; from Drive's point of view
nothing happened to them.

- **Moved out of the root:** cascade the soft-delete from *our own mirrored tree*. This is also
  why it still works when the folder has moved somewhere we can no longer read — we are reading
  our copy, not Drive.
- **Moved into the root:** enqueue a **persisted** subtree crawl (`pending_subtree_crawls`), so
  an invocation timeout does not lose the work.
- **Folder changes are always applied before file changes within a page**, so the scope
  resolver's view is correct before any file in that batch is judged.

The transition table lives in `src/lib/sync/changes.ts` as pure functions, precisely so it can
be tested without a database or a network.

### Failure modes that are states, not errors

`/api/sync` answers **HTTP 200 for every designed state**. The endpoint's contract is "here is
the state of the Drive connection", and a broken connection is a valid state.

- **`invalid_grant`** (§2) → returned as `tokenStatus`, polling stops, the reconnect banner
  appears, and **the Library stays fully browsable** — the projection is still valid, only
  freshness is broken. Punishing the user with a hidden Library because Google expired a token
  would be the wrong trade.
- **`410 Gone` page token** → full re-crawl plus a generation-stamped (`sweep_id`)
  reconciliation sweep. Anything not visited by the crawl is no longer in the subtree, which is
  the only way to catch deletions that happened while the token was dead.
- **Scope undeterminable** (Drive refuses to answer during an ancestry walk) → the item is
  **deferred, not written and not treated as out-of-scope**, so it retries next run rather than
  vanishing silently. Failing closed must never mean failing permanently.

### Open question carried forward

Phase 2's unattended extraction needs a trigger that is not a browser tab. §8's answer — a
GitHub Actions cron hitting a shared-secret endpoint — applies, and it will call the same
`sync_root`. Nothing in this section changes when that lands.

---

## 14. Authentication — Decided: hand-rolled OAuth, not Auth.js

Server-side authorization-code flow with PKCE and `state`, our own signed HttpOnly session
cookie, and opaque DB-backed sessions. `google-auth-library` is used for exactly three things:
the code→token exchange, ID token verification, and refresh.

**Rationale.** §9 names hands-on OAuth experience as an explicit project goal, and §1 requires
the raw refresh token in our own encrypted column regardless — which is precisely the part an
auth library would otherwise own. Auth.js would have to be reached past for the one thing that
actually matters here.

### Identity: track users, but let Google do the authenticating

Google is the sole authenticator: no passwords, no email verification of our own, no recovery
flow. A `users` row exists for identity *persistence*, which §1 already forces — encrypted
per-user refresh tokens need an owner, every domain row is `user_id`-scoped, and Google issues
an ID token at consent rather than a session, so the session is ours either way.

**`google_sub` is the identity key. Never look a user up by email** — emails get changed and
reassigned, and an email-keyed lookup is an account-takeover primitive. `email`, `name` and
`picture` are cached for display and refreshed from the ID token on every login.

`users` and `google_accounts` are separate tables: the grant has a different lifecycle than the
identity (revoke and re-grant without the user changing), and keeping the secret out of the row
you `select` for display makes accidental serialization to the client structurally harder.

### Details that are easy to get wrong

- **`prompt=consent` unconditionally.** Google returns a refresh token *only* on the consent
  grant; a silent re-auth of an already-consented app returns an access token with none. The
  alternative — omit it, detect the absence, retry — is more code guarding a worse invariant.
- **`redirect_uri` is derived from `APP_URL`, never from a request header.** Host-header
  injection into an OAuth redirect is a real attack and this is the one place it could enter.
- **Sessions are opaque tokens stored as `sha256`, not JWTs.** A JWT cannot be revoked, and a
  sign-out that does not sign out is not acceptable in a multi-tenant app.
- **Signing out does not disconnect Drive.** They are separate actions with separate routes;
  disconnecting revokes at Google and nulls our copy but **keeps the projection**, so
  reconnecting is instant.
- **The consent screen scope list is a separate console page from the credentials.** A scope
  absent from *Google Auth Platform → Data Access* is silently dropped from the granted set:
  sign-in appears to succeed and the app then has no Drive access. The callback checks the
  returned scope string explicitly and refuses rather than half-connecting.

---

## 15. Ontology shape and constraints — Decided: closed vocabulary, enforced in the catalog

Phase 2A. The full design is in [ontology-design.md](ontology-design.md); this records why it is
shaped the way it is. The organising principle: **an invalid claim must be impossible to write,
not merely something we remember to check.** The writer we are guarding against is an LLM, and it
produces plausible nonsense at a rate no code review catches.

### One entities table, not nine

The original draft floated a unified `entities` table as a tidiness win. It is actually forced:
claims need a single foreign-key target and Postgres has no polymorphic foreign key. Nine tables
would mean either nine nullable FK columns per claim or no referential integrity at all, and
"managing that by hand" was ruled out immediately.

Going the other way — dropping `entity_type` entirely — was also rejected. Type is what makes
domain and range expressible; without it there is no way to say that `ruled_by` takes a
settlement and not an artifact.

### One claims table, not two

Relationship and attribute claims share every downstream concern: sourcing, canonicity, temporal
bounds, conflict detection, "which claims cite this document". Splitting them means writing all
of that twice and `UNION`-ing every query. Nullable value columns are the cheaper cost.

### Predicates as a lookup table, not free text

The single highest-value constraint in the design. A free-text relationship column admits
`rules`, `ruled_by`, `is_ruler_of` and `governs` as four names for one fact, and a graph that
cannot answer its own questions is the failure this project exists to prevent.

`predicate_signatures` is a separate table because one predicate has several legal signatures and
because the *combination* is what matters — independent subject and object lists would permit
their cross product, which is wider than the truth.

### Reference tables are per-user

§1 permits global reference data, and this deliberately does not use that allowance. A world's
vocabulary is part of the world; one user adding a `Starship` type must not add it to everyone's
ontology. Scoping costs one column now and is expensive to retrofit — the same argument §5 makes
for `workspace_id`. It also lets `user_id` participate in the entity foreign keys, so a claim
reaching into another tenant's entities fails in the catalog rather than in a `WHERE` clause
someone might forget.

### Denormalized types on claims, and the FK chain they buy

`claims.subject_type` / `object_type` duplicate what `entities` already knows. This was
questioned and is worth restating: `CHECK` constraints cannot contain subqueries, so a rule that
requires a lookup has only two homes — denormalized columns plus foreign keys, or a trigger.

Chosen: **columns and foreign keys.** §8 makes Drizzle the sole owner of the schema, and a
trigger is a hand-written SQL blob Drizzle cannot see, type, or diff — constraint logic outside
the tool that owns the schema is how a rule silently disappears in a future migration. The
redundancy is self-policing: composite FKs into `entities (user_id, id, entity_type)` make the
copy provably honest, and retyping an entity cascades into its claims.

Rejected alternative — **enforce only in Zod.** It is where the good error messages come from and
it runs first, but it is a layer that can be bypassed by any script, any migration backfill, and
any future code path that forgets it.

### The `'@none'` sentinel, and why an ugly detail earns its place

Postgres foreign keys use `MATCH SIMPLE`: a NULL in any referencing column silently disables the
entire constraint. Attribute claims have no `object_type`, so the signature FK would have been
switched off for exactly the claims it most needed to check — a failure mode that looks like
working code.

Two `NOT NULL` generated columns (`object_type_key`, `value_kind`) project the nullable reality
onto a total key space, with `'@none'` standing in for "no object" / "no value". A name-format
`CHECK` on `entity_types.name` and `predicates.name` guarantees the sentinel cannot collide.

The payoff is that **one five-column foreign key** enforces predicate existence, domain, range,
relationship-vs-attribute consistency, and value-column/value-type agreement. Five rules
collapse into one constraint that cannot be forgotten.

The cost is a generic error message on violation, which is why Zod runs first, and a schema that
needs the comment block it has. Recorded here because the sentinel looks like a hack out of
context and is the thing most likely to be "cleaned up" by someone who does not know what
`MATCH SIMPLE` does.

### In-world time is a text label plus a *derived* sort key

`start_date` / `end_date` cannot be `timestamptz`: Nevlos counts years Before Doom (BD) and After
Doom (AD), to year and usually month. Stored as the verbatim in-world label plus a float sort key,
with date-valued attributes getting the same pair. This is the one place the original draft's
field list was wrong for the domain rather than merely underspecified.

Because the calendar is *regular* — two eras, ordered years, months within years — the sort key
is computable, so it is **derived by a parser rather than supplied by the writer**. An LLM asked
for an ordinal will confidently invent one, and calendar rules belong in one testable function
rather than in a prompt. An unparseable label is still stored with a null key: unordered, not
lost, per §7a.

The calendar Nevlos is reckoned by, and the ordinal encoding, are written up in
[calendar.md](calendar.md); `src/lib/ontology/calendar.ts` implements it. Because the ordinal is
a plain float on one scale, the world's other calendar systems need a parser landing on that
scale rather than a second ordering.

Rejected: **era / year / month as real columns.** More queryable and directly checkable, but it
hardcodes one world's calendar into the schema and costs nine columns across the three date
pairs. If era- or year-scoped queries become common they can be added later as generated columns
over the parsed value, without touching stored data — the cheaper direction to defer.

### Entity name uniqueness — rejected

An earlier revision made `normalized_name` unique per `(user, entity_type)` as a structural
defence against an extractor minting "Sera", "sera" and "Sera." as three characters. Reverted:
two distinct entities of one type may legitimately share a name, and a unique index makes that
unrepresentable rather than merely worth reviewing — the schema would be asserting something
about the world that is not true.

Duplicate suppression moves to the entity matcher, which must resolve an exact normalized hit to
the existing row or raise the collision, never silently mint a second one. Weaker in that it can
be bypassed, and correct in that it can be overridden.

### What is deliberately not enforced

- **`value_enum` membership** — Zod. Doing it in Postgres means a trigger; see above.
- **Cardinality and contradiction** — Phase 3. `is_functional` and `is_temporal` are carried now
  and read by nothing, purely so that phase needs no migration. Two rulers is only a conflict if
  the validity windows overlap, which is precisely the gating the implementation plan asks for.

### Testing against a real Postgres

The whole guarantee lives in the catalog, so asserting it in application code would prove
nothing. `src/lib/ontology/constraints.test.ts` applies the real migrations to **PGlite**
(Postgres compiled to WASM, in-process) and asserts each rejection by constraint name. It adds
one devDependency, needs no Docker daemon, and runs in about a second.

### Growth: a proposals queue, not an open vocabulary

A closed vocabulary that cannot grow strangles the project the first time the extractor correctly
identifies a relationship we did not anticipate. Phase 2B's extraction schema will therefore
accept a structured `proposed_predicate` that lands in a queue for human promotion rather than in
the graph. Closed at write time, open over the project's life — and the queue is a useful signal
of where the ontology is thin.
