# stone-brain

A document-consistency manager and conflict adjudication system that uses an LLM to extract structured claims and entity relationships from a text corpus, uses them to construct a Postgres knowledge graph, and intelligently detects contradictory claims.

## Docs

- [docs/implementation-plan.md](docs/implementation-plan.md) — phased build order
- [docs/ontology-design.md](docs/ontology-design.md) — entities and claim shapes
- [docs/architecture-decisions.md](docs/architecture-decisions.md) — agreed technical decisions and open questions
- [spikes/drive-file-scope/](spikes/drive-file-scope/) — runnable test of the blocking Phase 1 OAuth scope question

## Running the site locally

The app itself is a Next.js 16 app in `src/`, backed by Neon Postgres and Google Drive. It
needs Node 22+, a Neon database, and a Google OAuth client before it will start.

**1. Install dependencies**

```bash
npm install
```

**2. Configure the environment**

```bash
cp .env.example .env.local
```

Fill in every value — `src/lib/env.ts` validates them at boot and the app will refuse to
start if any are missing:

- `DATABASE_URL` / `DATABASE_URL_UNPOOLED` — the pooled and direct connection strings from
  your Neon project. The app runs on the pooler; drizzle-kit needs the direct one for DDL.
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — a **Web application** OAuth client from the
  Google Cloud console. Enable the Drive API on the project, and add
  `http://localhost:3000/api/auth/google/callback` as an Authorized redirect URI. It must
  match `${APP_URL}/api/auth/google/callback` character for character. While the consent
  screen is in testing, add yourself as a test user — the app requests the restricted
  `drive.readonly` scope.
- `APP_URL` — `http://localhost:3000` for local dev.
- `SESSION_SECRET` and `TOKEN_ENC_KEY_V1` — each `openssl rand -base64 32`. Leave
  `TOKEN_ENC_ACTIVE` at `v1`.

**3. Apply the migrations**

```bash
npm run db:migrate
```

`npm run db:studio` opens a browser UI over the same database if you want to poke at rows.

**4. Start the dev server**

```bash
npm run dev
```

Open <http://localhost:3000>. First run sends you to `/connect` to authorize Google, then to
`/setup/folder` to pick the Drive folder to mirror; after that the Library syncs and the rest
of the app unlocks.

Other useful scripts: `npm run typecheck`, `npm test` (Vitest), `npm run lint`, and
`npm run build && npm start` for a production build.

## Running the frontend prototype locally

`frontend/` holds the Claude Design export, not a built app. `Stone Brain.dc.html` is a
template interpreted at runtime by `support.js`, which pulls React 18, Babel, and Phosphor
icons from unpkg — so you need to be online, and the files must be served over HTTP
(opening them with `file://` will not work).

From the repo root:

```bash
python3 -m http.server 4173
```

Then open:

- Main prototype — <http://localhost:4173/frontend/Stone%20Brain.dc.html>
- Layout variations — <http://localhost:4173/frontend/Stone%20Brain%20-%20Variations.dc.html>

The design canvas is a fixed 1440×900 frame, so use a wide browser window. Stop the server
with `Ctrl-C`.

`frontend/_ds/nocturne-*/` is the Nocturne design system (one `styles.css` of tokens plus a
`readme.md` of usage rules). Note that the main prototype overrides Nocturne's blurple accent
with a gold palette in its own inline `<style>` block.
