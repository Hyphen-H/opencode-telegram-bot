# Hyphen-H fork deployment

This fork keeps the collapsible bottom keyboard in source control. The collapsed
preference survives restarts in the existing app home's `settings.json`.
`/menu` restores the full keyboard. Toggling sends no confirmation text: Telegram
requires a new message to update a reply keyboard, so the bot sends a silent,
invisible carrier and deletes it and the button input. If Telegram forbids
deletion, an invisible carrier or the input may remain. This is a reply-keyboard
workaround; verify keyboard behavior on the Telegram clients you use.

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

## Updates

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
