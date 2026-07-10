# mail-mcp

> Built on [davidvornholt/standards](https://github.com/davidvornholt/standards).

A draft-only IMAP helper for Thunderbird workflows, exposed to Claude as an **MCP server** and to you as a **`mail` CLI** over one shared Effect core. It can search, read, and save drafts across your accounts; it never sends or deletes. Drafts land in the account's Drafts folder and sync into Thunderbird, where you review and send them.

## Layout

```
apps/mail            the application (MCP server + CLI)
  src/app            entrypoints: server.ts (MCP, stdio), cli.ts (the `mail` bin)
  src/features/mail  schemas, tagged errors, and Effect services (config, secrets, imap, draft)
  src/shared         app-local infrastructure (arg parsing, hidden-input terminal prompt)
packages/*           canonical shared config synced from the standards template
```

See [`apps/mail/README.md`](apps/mail/README.md) for the tool list, configuration, and secret handling.

## Setup

```bash
bun install

# put the `mail` command on your PATH (one-time; links the app's bin into
# ~/.bun/bin). After this, run `mail …` from anywhere.
bun link --cwd apps/mail

# configure your accounts (non-secret: addresses, IMAP hosts, ports). The real
# file is git-ignored so your addresses never land in git.
cp apps/mail/accounts.example.toml apps/mail/accounts.toml
# …edit apps/mail/accounts.toml…

# store each account's password in the OS keyring (hidden prompt — nothing is
# echoed or written to disk). Run this yourself; the secret never leaves your
# machine.
mail login you@example.com

# confirm each account authenticates cleanly (or shows what still needs a login)
mail status
```

The MCP server is registered with Claude Code (user scope):

```bash
claude mcp add --scope user mail -- bun run <repo>/apps/mail/src/app/server.ts
```

Once a password is stored, ask Claude to search your mail or draft a reply, or drive it yourself:

```bash
mail search you@example.com invoice
```

Not ready to link a global command? Every example also works as `bun run apps/mail/src/app/cli.ts <args>`.

## Requirements

- Bun (see `packageManager` in `package.json`).
- A running, unlocked Secret Service provider (gnome-keyring) for the OS keyring.

## Quality gate

`bun run check` runs the standards drift check, then lint, type-check, tests, build, and a11y across every workspace. It must pass before a change is done.
