# Review decisions registry

Deliberate, already-litigated review decisions. Reviewers: do not re-report an
entry as a finding; challenge one only with evidence that did not exist when it
was decided, naming its id.

Entry format: `## <id> — <title>`, then Date, Decision, Rationale, Scope.

## D-2026-07-10-canonical-deferred-upstream — Findings in bucket-1 canonical files route upstream, not to local fixes

- Date: 2026-07-10
- Decision: Confirmed review findings whose fix would edit a canonical synced
  file (listed in `sync-standards.json` `paths`) are dispositioned as
  **deferred-upstream** and are not fixed in this repo. They are tracked for a
  change in `davidvornholt/standards` followed by a re-sync.
- Rationale: The standards-sync golden rule — bucket-1 files are read-only in a
  consumer; a local edit is drift that `--check` fails and the next `sync`
  overwrites.
- Scope: applies to all reviews in this repo. Currently deferred upstream (from
  the 2026-07-10 review loop, all confirmed):
  - `.claude/workflows/review-pass.js`: (a) blocking — no normalization when the
    harness delivers `args` as a JSON string; `pipeline(args.lenses, …)` throws
    (observed in practice); (b) verification verdicts are lost in the merged
    output (`verdictFor` keys on object identity, which does not survive the
    harness's `parallel()` result journaling — verify agent returned `upheld`,
    merged finding carried `verdict: null`); (c) exact dedup keys on file+line
    only and can collapse two distinct defects reported at the same location;
    (d) a skipped/failed lens reviewer is silently omitted instead of flagged,
    letting an orchestrator mistake a partial pass for a full one; (e) nit —
    `exact.lenses.push` can append duplicate lens keys; (f) nit — absent
    `lens.notes` yields a double blank line in the review prompt.
  - `.agents/skills/ux-ui/SKILL.md`: references another project's artifacts
    (root `DESIGN.md`, `packages/ui/src/theme.css`, `apps/web/*`,
    `@fesk/ui/motion`, Titan One) that do not exist in this repo; the
    project-specific content leaked into the canonical template and must be
    generalized upstream.
  - `.claude/agents/reviewer.md`: blocking — the `skills: - review` frontmatter
    does not resolve to `.agents/skills/review/SKILL.md`; the bare name is
    shadowed by Claude Code's built-in `/review` PR command, whose content is
    injected instead (reproduced at runtime). The agent body's "injected review
    skill" premise is false; reviewers must read the skill from disk. Fix
    upstream (e.g. explicit path like the `.codex` counterpart).
  - `.claude/workflows/review-pass.js` (additional): (g) a failed/skipped
    verification agent yields `{ finding, verdict: null }` — always truthy, so
    the `if (entry)` guard never fires and the finding is emitted
    indistinguishable from "never verified"; the guard tests the wrong value.
  - `.codex/agents/reviewer.toml`: `sandbox_mode = "read-only"` conflicts with
    the embedded review skill's instruction to run focused checks/`bun run
    check` (verified empirically against codex-cli read-only sandbox semantics).
  - `.claude/workflows/review-pass.js` (nit): merged findings keep the stale
    singular `lens` field from the first contributor alongside the merged
    `lenses` array.
  - `.claude/workflows/review-pass.js` (h): `findingsSchema` unconditionally
    requires `file` and `line >= 1`, hardening the review skill's "whenever
    possible" into "always" and forcing fabricated anchors for findings with no
    natural location (missing tests, deleted files), which then poison the
    file+line dedup key and verify labels.
  - `.claude/workflows/review-pass.js` (nit): near-duplicate annotation uses
    the first entry within distance 3 (`merged.find`) rather than the nearest,
    so >2-entry clusters can point at the wrong candidate duplicate.
  - `.agents/skills/ux-ui/SKILL.md` (nit, upheld): the vibe-designing → ux-ui
    replacement dropped the predecessor's `agents/openai.yaml`
    (`allow_implicit_invocation: true`), silently losing the codex-side
    implicit-invocation surface; peers (database, github-actions,
    standards-sync) retain theirs.

## D-2026-07-11-sync-test-file-length-exception — sync-standards.test.ts over 200 lines is an accepted, documented exception

- Date: 2026-07-11
- Decision: `scripts/sync-standards.test.ts` (~232 lines) exceeding the
  AGENTS.md 200-line guideline is accepted and recorded in
  `docs/quality/no-excessive-lines-per-file-exceptions.md`.
- Rationale: the file is bucket-1 canonical; broad behavioral coverage of one
  boundary file is clearer as a single colocated test file, and the split/keep
  decision belongs upstream, same as the engine itself.
- Scope: do not re-report the file's length while the exceptions-doc entry
  exists.
