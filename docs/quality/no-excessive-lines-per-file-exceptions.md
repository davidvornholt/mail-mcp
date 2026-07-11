# Exceptions: lines-per-file limit

Files allowed to exceed the 200-line guideline from `AGENTS.md`, each with its
justification. Remove an entry when the file is split or shrinks below the
limit.

- `scripts/sync-standards.ts` (~480 lines) — canonical synced mirror of the
  standards-template sync engine. It is deliberately a single zero-dependency
  file so the bootstrap one-liner can fetch and run it raw before any install;
  splitting it would break that contract. The file is read-only in this repo
  (owned by davidvornholt/standards), so the split/keep decision belongs
  upstream.
- `scripts/sync-standards.test.ts` (~232 lines) — canonical synced test suite
  for the sync engine (bucket-1, read-only in this repo, owned by
  davidvornholt/standards). Broad behavioral coverage of one boundary file is
  clearer as a single colocated test file, and the split/keep decision belongs
  upstream, same as the engine itself.
