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
