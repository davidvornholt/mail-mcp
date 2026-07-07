# Project-specific rules

Rules here extend the canonical `AGENTS.md` for this repository only. `AGENTS.md`
is the single source of truth and is synced from davidvornholt/standards — do
not edit it locally. Add project-specific guidance here instead.

## Secrets: OS keyring instead of SOPS

The canonical contract routes secret values through SOPS-encrypted YAML. This
project deliberately diverges for its one runtime secret — the per-account IMAP
password — and stores it in the **OS keyring** (Secret Service / gnome-keyring)
instead, so the password never lands on disk in any form, encrypted or not.

Consequences:

- There are no SOPS secret targets to populate; `secrets/*.example.yaml` stay
  as their canonical placeholders.
- The secret is written by `mail login <email>` (a hidden prompt) via
  `@napi-rs/keyring` under the service name `mail-mcp`, and read back at runtime
  by the MCP server and CLI. It is documented in `apps/mail/README.md`.
