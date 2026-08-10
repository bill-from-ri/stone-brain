# Phase 1 — local setup

Everything here is manual and one-time. Nothing in it costs money.

When you're done, `npm run dev` should take you through: `/connect` → Google consent →
`/setup/folder`. (The folder picker itself is still being built; landing on that page is the
success condition for now.)

---

## 1. Neon database

1. Create a project at <https://console.neon.tech>. The free tier is fine — 0.5 GB, and
   exceeding it suspends compute without deleting data, which is why it was chosen over
   Supabase (decisions §12).
2. From the project dashboard, copy **two** connection strings:
   - the **pooled** one (host contains `-pooler`) → `DATABASE_URL`
   - the **direct** one (no `-pooler`) → `DATABASE_URL_UNPOOLED`
3. Paste both into `.env.local`, replacing the `FILL_ME` placeholders.
4. Apply the schema:

   ```bash
   npm run db:migrate
   ```

   Six tables: `users`, `google_accounts`, `sessions`, `sync_state`, `folders`, `documents`.

Migrations run over the **direct** connection because DDL needs a real session; the app runs
over the pooled one.

---

## 2. Google Cloud console

Reuse the project you created for the `drive.file` spike — everything below is an edit to it,
not a new project.

### 2.1 Enable the API

*APIs & Services → Library* → enable **Google Drive API**.

You can **disable the Google Picker API**. Decisions §2 dropped it: with `drive.readonly` we
enumerate Drive ourselves and build the folder browser in-app.

### 2.2 Branding

*Google Auth Platform → Branding.* **App name**, **User support email**, and **Developer
contact information** must all be filled in and saved. A half-configured consent screen throws
opaque policy errors rather than useful ones — the spike README documents this failure mode at
length.

### 2.3 Scopes

*Google Auth Platform → Data Access → Add or remove scopes.* Add all four:

| Scope | Classification |
| --- | --- |
| `openid` | non-sensitive |
| `.../auth/userinfo.email` | non-sensitive |
| `.../auth/userinfo.profile` | non-sensitive |
| `https://www.googleapis.com/auth/drive.readonly` | **restricted** |

The console will flag the last one as restricted. That is expected and is exactly the decision
recorded in §2. The justification textarea only matters at verification time — leave it for
Phase 5.

### 2.4 Audience

Stay on **Testing** while building, and add your own Google account under **Test users**.
Being the project owner is *not* sufficient.

Flip to **In production** before inviting anyone. When you do, **verify the refresh-token
expiry behaviour directly** — §2 flags it as a confidence note, and it is a one-click setting
with immediately observable behaviour. The claim to check: under Testing, authorizations expire
7 days after consent; under Production (verified or not) they do not.

### 2.5 Credentials — this is the step that differs from the spike

*Credentials → your existing Web application OAuth client.*

The spike used **Authorized JavaScript origins**, because it ran an implicit browser flow.
This is a server-side authorization-code flow, so it uses **Authorized redirect URIs** instead.
Add:

```
http://localhost:3000/api/auth/google/callback
https://<your-project>.vercel.app/api/auth/google/callback
```

Exact match. No trailing slash. `127.0.0.1` and `localhost` are different origins to Google.

Then **copy the Client secret** — the spike ran as a public client with none, but this flow
needs one. Put the client ID and secret into `.env.local`.

> Credential edits propagate anywhere from five minutes to a few hours. If a fix appears not to
> work, wait before assuming it was wrong.

---

## 3. Run it

```bash
npm run dev
```

Open <http://localhost:3000>. You should be redirected to `/connect`.

Clicking **Connect Google Drive** takes you to Google's consent screen, which will show an
**unverified app** warning. That is expected under §2 — click through via *Advanced → Go to
Stone Brain*. This is also why the connect screen carries a footnote about Google's
account-level grant: the warning is the very next thing a user sees, and it should not be a
surprise.

---

## 4. Verifying the gate

With the app running:

```bash
# Signed out: every route bounces to /connect, and the API refuses.
curl -si localhost:3000/library  | head -1   # 307 -> /connect
curl -si localhost:3000/settings | head -1   # 307 -> /connect
```

After signing in, you should land on `/setup/folder` and **not** the Library — a signed-in user
with no chosen root folder has exactly one thing available to them, which is the "no other
options until connected" requirement.

---

## 5. Deployment env vars

When deploying to Vercel, set all of these for every environment. `SESSION_SECRET` and
`TOKEN_ENC_KEY_V1` should be **different values from your local ones**, generated the same way
(`openssl rand -base64 32`).

| Variable | Notes |
| --- | --- |
| `DATABASE_URL` | pooled |
| `DATABASE_URL_UNPOOLED` | direct; migrations only |
| `GOOGLE_CLIENT_ID` | |
| `GOOGLE_CLIENT_SECRET` | never a `NEXT_PUBLIC_*` var |
| `APP_URL` | must match the registered redirect URI exactly |
| `SESSION_SECRET` | 32+ bytes |
| `TOKEN_ENC_KEY_V1` | base64, exactly 32 bytes |
| `TOKEN_ENC_ACTIVE` | `v1` |

**Preview deployments are an unsolved annoyance.** Every Vercel preview gets a unique hostname
and you cannot enumerate them in the redirect URI list. Register the stable branch alias
(`https://<project>-git-main-<team>.vercel.app/...`) and only sign in from that one. Do not
build a dev-only login bypass.

### Rotating the encryption key

Add `TOKEN_ENC_KEY_V2`, flip `TOKEN_ENC_ACTIVE` to `v2`, and leave `TOKEN_ENC_KEY_V1` in place.
Existing envelopes keep decrypting because the key ID is embedded in each one, and every
successful token refresh re-encrypts under the active key, so the population drains on its own.
Remove `V1` once it has.
