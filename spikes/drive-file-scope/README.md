# Spike: does `drive.file` reach a picked folder's descendants?

This is the decisive Phase 1 question. See §2 of
[../../docs/architecture-decisions.md](../../docs/architecture-decisions.md).

**What we need to know:** if a user selects a *folder* in the Google Picker while the app holds
only the non-sensitive `drive.file` scope, does the app get access to the Google Docs *inside*
that folder?

- **Yes** → Plan A. Unlimited users, no Google verification, no cost. The onboarding flow we
  already want ("pick the folder that is your world") just works.
- **No** → Plan B. `drive.readonly` in Testing mode: still fully multi-tenant, but capped at
  100 named testers with weekly re-consent.

## Why this can't be answered from the docs

Google documents `drive.file` as "per-file access" and never addresses folder descendants
either way. The Picker docs describe folder selection but say nothing about scope propagation.
The evidence *leans* toward Plan B — Drive's `isAppAuthorized` is a per-file boolean, and the
official remedy for the "user has not granted the app access to the file" error is to prompt
the user to open *that file* through the Picker — but that's inference, not a result. Twenty
minutes of setup gets a real answer.

## Setup

You need a Google Cloud project. All of this is free.

1. **Create a project** at <https://console.cloud.google.com/projectcreate>.
2. **Enable two APIs** under *APIs & Services → Library*: **Google Drive API** and
   **Google Picker API**.
3. **Configure the OAuth consent screen** (*APIs & Services → OAuth consent screen*):
   - User type: **External**, publishing status **Testing**.
   - Add your own Google account under **Test users**.
   - You do *not* need to add any scopes here — the spike requests `drive.file` at runtime.
4. **Create an OAuth client ID** (*Credentials → Create credentials → OAuth client ID*):
   - Application type: **Web application**
   - Authorized JavaScript origins: `http://localhost:4173`
   - Copy the **Client ID**.
5. **Create an API key** (*Credentials → Create credentials → API key*). Copy it. Restricting
   it to the Picker API is good hygiene but not required for the spike.

## Prepare a test folder

In your Drive, make a folder containing **at least one native Google Doc** — and make sure it
is a doc you have *never* opened through this app before, or the result is meaningless (a
previously granted file would show up regardless of folder propagation). A brand-new folder
with a brand-new doc is the clean test.

## Run

From the repo root:

```bash
python3 -m http.server 4173
```

Open <http://localhost:4173/spikes/drive-file-scope/>, paste the Client ID and API Key, click
**Run spike**, consent, and pick your test folder.

## Reading the result

The page runs four probes and prints a verdict:

| Probe | What it proves |
| --- | --- |
| 1. `files.get` on the folder | The folder resource itself was granted |
| 2. `files.list` of children | **The decisive one.** Empty list = per-file ACL confirmed = Plan B |
| 3. `files.export` of a child | Metadata visibility isn't enough; we need to read content |
| 4. `changes/startPageToken` | The sync design in §4 is reachable under this scope |

Probe 2 returning zero children while probe 1 succeeds is the signature of the per-file model:
the folder was granted, its contents were not.

Paste the output into §2 of the decisions doc and mark the scope decision **Decided**.

## Troubleshooting

### `Error 400: invalid_request` — "doesn't comply with Google's OAuth 2.0 policy"

This means Google *found* your client (note that the error page knows the app is called "Stone
Brain") but rejected the request. It is a configuration problem, not a code problem, and
re-running or hard-reloading will never fix it.

**Do this first.** On the error page, click **"see error details"** — visible only when you're
signed in as a developer of the project. Google names the exact rule that was violated, which
beats working through the list below.

Then, in rough order of likelihood:

1. **Wrong OAuth client type.** The client must be **Web application**. If you created a
   Desktop app, TV, or "Other" client, there is no *Authorized JavaScript origins* field at
   all and the browser flow fails with exactly this error. Check *Credentials* — the type is
   listed next to the client name. If it's wrong, delete it and create a new Web application
   client; you cannot change the type after creation.

2. **Origin mismatch.** The spike page now prints its own origin in a box at the top. It must
   appear **character for character** under *Authorized JavaScript origins*. The usual
   offenders:
   - `http://127.0.0.1:4173` and `http://localhost:4173` are **different origins** to Google.
     The page warns you if you're on the former.
   - A trailing slash. `http://localhost:4173/` is not `http://localhost:4173`.
   - Wrong port, if you started the server on something other than 4173.
   - Pasting into *Authorized redirect URIs* instead of *Authorized JavaScript origins*. This
     flow uses origins; the redirect URI field is irrelevant here and can stay empty.

3. **Incomplete consent screen.** Under *OAuth consent screen* (now "Google Auth Platform" in
   newer console builds), **App name**, **User support email**, and **Developer contact
   information** must all be filled in and saved. A half-configured consent screen throws
   policy errors rather than a useful message.

4. **Propagation delay.** Credential edits can take anywhere from five minutes to a few hours
   to take effect. If you just fixed the origin and nothing changed, wait and retry before
   assuming the fix was wrong.

### `Access blocked: Stone Brain has not completed the Google verification process`

Different error, different cause: your Google account isn't on the test user list. Add it
under *OAuth consent screen → Test users*. Being the project owner is not sufficient.

### `There was an error! The API developer key is invalid.`

OAuth succeeded and the Picker itself is rejecting the API key. Causes, in order:

1. **The Google Picker API is not enabled.** Enabling the Drive API does *not* enable it —
   they are separate products. *APIs & Services → Library* → "Google Picker API" → Enable.
   This is the usual cause.

2. **The key belongs to a different Cloud project than the OAuth client.** The leading number
   in your client ID (`123456789012-abc....apps.googleusercontent.com`) **is the project
   number**. Compare it to the project number shown on the dashboard of the project holding
   the API key; they must match.

3. **Key restrictions.** On the key in *Credentials*:
   - *API restrictions* — choose **Don't restrict key**, or include **Google Picker API**.
   - *Application restrictions* — if set to **Websites**, add `http://localhost:4173/*`
     including the wildcard. **None** is fine for the spike.

4. **Wrong value pasted.** An API key starts with `AIza` and runs about 39 characters. If
   yours doesn't, it's probably the OAuth client secret.

Key edits are subject to the same propagation delay as OAuth credential edits.

### The Picker never opens, or flashes and closes

Same first cause as above — the **Google Picker API** is not enabled — or `gapi` failed to
load. Check the browser console for network errors against `apis.google.com`.

