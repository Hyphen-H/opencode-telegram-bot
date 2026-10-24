# Hyphen-H fork deployment

This fork keeps the collapsible bottom keyboard in source control. The collapsed
preference survives restarts in the existing app home's `settings.json`.
`/menu` restores the full keyboard and its command input is kept. Toggling sends
no confirmation text: Telegram requires a new message to update a reply keyboard,
so the bot keeps its latest silent carrier showing the current session title
(or a session-selection prompt when none is selected). Only a previous carrier
and button inputs are cleaned up. Deleting the latest carrier retracts the
keyboard on some Telegram clients. Verify behavior on the clients you use.

Intermediate tool/diff attachments are off by default (`sendDiffFileAttachments`).
Tool progress stays as text, and final assistant responses are unaffected. The
setting remains available under `/settings` for explicit opt-in.

Queued settings writes capture their destination app home when scheduled;
configuration migrations finish their writes before startup continues. Tests flush
pending writes before removing temporary homes. This prevents a later environment
change during tests from redirecting queued writes into the deployed bot's settings.

## Deployment

Clone `https://github.com/Hyphen-H/opencode-telegram-bot.git`, then:

```sh
npm ci
npm run build
```

Configure the process supervisor to execute **this checkout's** `dist/cli.js`
using Node, with `start --mode installed`. Set `OPENCODE_TELEGRAM_HOME` to the
existing bot app home so credentials, settings and sessions are preserved.
Do not copy secrets into the checkout or commit `.env` files.

On the current server the OpenChamber-backend discovery wrapper starts the
checkout's CLI using `OPENCODE_TELEGRAM_CLI`. That wrapper remains outside npm's
installation directory, as does its systemd override. Global npm updates of the
official package therefore cannot replace the running fork code.

## Session deletion and archiving

Ordinary, recent and temporary session lists offer single-emoji 🗑️ and 📦 buttons alongside
each session. Both show a separate confirmation with the real session title.
Delete removes the OpenCode session record, not project files. Archive uses the
V2 server's archive API and excludes archived sessions from these lists; the data
remains restorable through OpenCode. Running sessions are checked before showing
confirmation and again before performing the action. Confirmation is tied to the
active menu and a single-use token, so stale, cancelled or duplicate confirmations
do not perform an operation. An API failure requires another explicit click.

## Creating a project

Use `/projects` → **New project** to browse the configured `OPEN_BROWSER_ROOTS`
(the home directory by default). Choose **New folder** to create a child folder,
or **Enter path** for an absolute path, `~/path`, or a path relative to the current
directory. Missing paths require confirmation before any directories are created.
Existing directories open in the browser without overwriting contents. Select the
current directory to add it to the project list; no git repository is initialized.
The same folder/path buttons are available in `/open`. Cancel or Back leaves the
creation flow, and typed paths are never forwarded as AI prompts.

## Temporary sessions

`/projects` groups OpenChamber's `chats/YYYY-MM-DD/session-*` directories under
**Temporary sessions**. Opening it lists all root temporary sessions by their real
OpenCode titles, newest first, with pagination. Selecting a session switches to
its original directory using the existing cross-project session selection flow.
`/sessions` also opens the grouped list when a temporary session is selected.

The bot creates stable `<sessionID>` directory symlinks under
`<OPENCODE_TELEGRAM_HOME>/temporary-sessions/`. Originals are never moved; existing
index entries are never overwritten or deleted. Missing original directories have
no link created. The index is refreshed when listing projects or temporary sessions,
not continuously in the background. In container mode only the Telegram grouping
is available because the bot cannot index host paths. Excluded project directories
are respected. Other non-git projects are not grouped.

## Updating from the fork

For deployed fork changes, from the clean deployment checkout:

```sh
git pull --ff-only origin main
npm ci
npm run build
sudo systemctl restart opencode-telegram-bot
```

To bring in upstream releases, merge them into this fork first, resolve conflicts,
run checks, and push to the fork before deploying:

```sh
git remote add upstream https://github.com/grinev/opencode-telegram-bot.git
git fetch upstream
git merge upstream/main
npm ci
npm run build
npm run typecheck
npm test
git push origin main
```

Add the upstream remote only once. Do not reset the fork to upstream or use a
GitHub force-sync operation: that would deliberately discard fork commits.
Ordinary merges retain the customization, but future conflicts still need review.
