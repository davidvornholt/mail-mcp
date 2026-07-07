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

# store an account password in the OS keyring (hidden prompt — nothing is echoed
# or written to disk). Run this yourself; the secret never leaves your machine.
bun run --cwd apps/mail cli.ts login user1@example.com
```

The MCP server is registered with Claude Code (user scope):

```bash
claude mcp add --scope user mail -- bun run <repo>/apps/mail/src/app/server.ts
```

Once a password is stored, ask Claude to search your mail or draft a reply, or drive it yourself:

```bash
bun run --cwd apps/mail cli.ts search user1@example.com invoice
```

## Requirements

- Bun (see `packageManager` in `package.json`).
- A running, unlocked Secret Service provider (gnome-keyring) for the OS keyring.

## Quality gate

`bun run check` runs the standards drift check, then lint, type-check, tests, build, and a11y across every workspace. It must pass before a change is done.
