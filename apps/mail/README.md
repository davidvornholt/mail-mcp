# @mail-mcp/mail

Draft-only IMAP helper, exposed two ways over one Effect core:

- **MCP server** (`src/app/server.ts`) — Claude searches, reads, and drafts email.
- **CLI** (`src/app/cli.ts`, the `mail` bin) — the same actions from your terminal.

It can `search`, `read`, and `save-draft` only. There is **no send and no delete/move**: drafts land in the account's Drafts folder and you review and send them from Thunderbird.

## Commands

```bash
mail login <email>                     # store a password in the OS keyring (hidden prompt)
mail accounts                          # list configured accounts
mail folders <email>                   # list folders
mail search <email> <query...>         # search, newest first
mail read <email> <folder> <uid>       # print one message
echo "body" | mail draft <email> --to a@b.com --subject "Re: x" [--cc c@d.com] [--in-reply-to <id>]
```

Run the MCP server with `bun run src/app/server.ts` (see the repo root README for registering it with Claude Code).

## Configuration

Non-secret account configuration lives in `src/features/mail/schemas/account.ts` (email, display name, IMAP host, port, TLS, login user). It was derived from Thunderbird's `prefs.js`. Add or change accounts by editing that file.

| Value | Required | Behavior |
| --- | --- | --- |
| account host / port / secure / user | yes | IMAP connection settings per account. Port 993 + `secure: true` (implicit TLS) for all current accounts. |

## Secrets

This workspace consumes **one secret per account: the IMAP password**. It is **not** stored in the repo, in SOPS, or in any file — it lives in the **OS keyring** (Secret Service / gnome-keyring on Linux) under the service name `mail-mcp`, keyed by the account email. Store it with `mail login <email>`, which reads it from a hidden prompt and writes it straight to the keyring; the server and CLI read it back at runtime via `@napi-rs/keyring`.

A Secret Service provider must be running and unlocked in the session where the server or CLI runs.
