# Exceptions: lines-per-file limit

Files allowed to exceed the 200-line guideline from `AGENTS.md`, each with its
justification. Remove an entry when the file is split or shrinks below the
limit.

- `apps/mail/src/app/cli.ts` (~209 lines) — the CLI entrypoint is a single
  command router: it parses argv and dispatches every `mail` subcommand (login,
  accounts, status, folders, search, read, draft) to a thin handler. Keeping the
  dispatch table and its handlers in one boundary file is clearer than
  fragmenting the entrypoint; the business logic already lives in
  `src/features/mail/services`.
