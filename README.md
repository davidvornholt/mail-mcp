# mail-mcp

> Built on [davidvornholt/standards](https://github.com/davidvornholt/standards).

A draft-only IMAP helper for Thunderbird workflows, exposed to Codex, Claude, and other compatible clients as an **MCP server** and to you as a **`mail` CLI** over one shared Effect core. Through the MCP server it can search and read mail and create, update, or delete drafts with HTML and attachments; the `mail` CLI covers login, status, folder/search/read, and plain-text draft creation. It cannot send emails: drafts sync into Thunderbird for review and sending.

## Layout

```
apps/mail            the application (MCP server + CLI)
  src/app            entrypoints: server.ts (MCP, stdio), cli.ts (the `mail` bin)
  src/features/mail  schemas, tagged errors, and Effect services (config, secrets, status, IMAP, draft, login)
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

# configure your accounts (non-secret: addresses, IMAP hosts, and ports). The real
# file is git-ignored so your addresses never land in git.
cp apps/mail/accounts.example.toml apps/mail/accounts.toml
# …edit apps/mail/accounts.toml…

# verify each account's password against IMAP, then store it in the OS keyring
# (hidden prompt — nothing is echoed or written to disk). Run this yourself;
# the secret never leaves your machine.
mail login you@example.com

# confirm each account authenticates cleanly (or shows what still needs a login)
mail status
```

Register the MCP server with Codex:

```bash
codex mcp add mail -- bun run <repo>/apps/mail/src/app/server.ts
codex mcp get mail
```

Codex defers MCP tool definitions until they are relevant, so registering the
server does not eagerly add every mail tool schema to the model context. Restart
Codex after adding it, then use `/mcp` to inspect the connected server.

For explicit write approvals and more headroom for IMAP operations, edit the
generated entry in `~/.codex/config.toml`:

```toml
[mcp_servers.mail]
command = "bun"
args = ["run", "<repo>/apps/mail/src/app/server.ts"]
startup_timeout_sec = 15
tool_timeout_sec = 120
default_tools_approval_mode = "writes"

[mcp_servers.mail.tools.delete_draft]
approval_mode = "prompt"
```

For Claude Code (user scope), use:

```bash
claude mcp add --scope user mail -- bun run <repo>/apps/mail/src/app/server.ts
```

Once a password is stored, ask your MCP client to search your mail or compose a draft. You can also drive the review-first CLI yourself:

```bash
mail search you@example.com invoice
```

Search is global by default. Use `--scope folder --folder INBOX` for one exact folder or `--scope subtree --folder Projects` for a folder and its descendants.

Not ready to link a global command? Every example also works as `bun run apps/mail/src/app/cli.ts <args>`.

## Requirements

- Bun (see `packageManager` in `package.json`).
- A running, unlocked Secret Service provider (gnome-keyring) for the OS keyring.

## Quality gate

`bun run check` runs the standards drift check, then lint, type-check, tests, build, and a11y across every workspace. It must pass before a change is done.
