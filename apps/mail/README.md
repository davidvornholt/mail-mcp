# @mail-mcp/mail

Draft-only IMAP helper, exposed two ways over one Effect core:

- **MCP server** (`src/app/server.ts`) — Claude searches, reads, and creates, updates, or deletes drafts.
- **CLI** (`src/app/cli.ts`, the `mail` bin) — login, status, folder/search/read, and plain-text draft creation from your terminal.

The MCP tools support plain-text or HTML bodies and local file attachments, including inline images referenced from HTML by `cid`. Draft updates and deletion use a folder and UID and refuse to modify messages outside the account's Drafts folder; passing back the `uidValidity` from a draft's save response guards against a mailbox reindex expunging the wrong message. There is no send operation: drafts sync into Thunderbird for review and sending.

## Commands

```bash
mail login <email>                     # verify and store a password in the OS keyring
mail accounts                          # list configured accounts
mail status [email] [--quick]          # check auth per account (--quick: keyring only, no connect)
                                       # exits non-zero if any checked account fails
mail folders <email>                   # list folders
mail search <email> <query...>         # search, newest first
mail read <email> <folder> <uid>       # print one message
echo "body" | mail draft <email> --to a@b.com --subject "Re: x" [--cc c@d.com] [--in-reply-to <id>]
```

Run the MCP server with `bun run src/app/server.ts` (see the repo root README for registering it with Claude Code).

## Configuration

Non-secret account configuration lives in `accounts.toml` (email, display name, IMAP host, port, TLS, login user), one `[[accounts]]` block per account. Copy `accounts.example.toml` to `accounts.toml` and edit it; the file is git-ignored so real addresses stay out of git. `MailConfig` loads and zod-validates it at startup, so a missing or malformed file fails loudly with an actionable message. The initial accounts were derived from Thunderbird's `prefs.js`.

| Value | Required | Behavior |
| --- | --- | --- |
| `accounts.toml` | yes | Account inventory. Must declare at least one account; each needs `email`, `name`, `host`, `port`, `secure`, `user`. |
| account host / port / secure / user | yes | IMAP connection settings per account. Port 993 + `secure = true` selects implicit TLS. |
| `MAIL_ACCOUNTS_CONFIG` | no | Absolute path to an alternate accounts TOML file. Defaults to `accounts.toml` at the app root. |

## Secrets

This workspace consumes **one secret per account: the IMAP password**. It is **not** stored in the repo, in SOPS, or in any file — it lives in the **OS keyring** (Secret Service / gnome-keyring on Linux) under the service name `mail-mcp`, keyed by the account email. Store it with `mail login <email>`, which reads it from a hidden prompt, verifies it against the account's IMAP server, and writes it to the keyring only after successful authentication; the server and CLI read it back at runtime via `@napi-rs/keyring`.

A Secret Service provider must be running and unlocked in the session where the server or CLI runs.
