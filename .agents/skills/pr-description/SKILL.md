---
name: pr-description
description: >-
  Write reviewer-ready pull request titles and bodies with semantic titles,
  exact diff statistics, explicit verification, scope boundaries, and P0-P3
  risk analysis.
triggers:
  - write PR description
  - create pull request body
  - semantic PR title
  - PR risk analysis
---

# Pull Request Description

Use this skill when writing or revising a pull request title and body. The
description is a review artifact: state the exact scope, evidence, and risk.
Do not invent results, counts, commands, or affected areas.

## Semantic title

Use this form:

`type(scope): imperative subject`

The scope is optional. The subject must be concise, specific, and imperative;
do not end it with a period. Use one of the exact types accepted by CI:

`feat` · `fix` · `chore` · `docs` · `refactor` · `test` · `ci` · `perf`

Keep the title to roughly 5–10 words after the type/scope, describe the main
user-facing or engineering outcome, and do not include an issue number unless
the request supplies one.

### Title examples

Valid:

- `feat(agent): Add undo for pending deletions`
- `fix: Prevent stale session resurrection`
- `docs: Document IPC contract testing`
- `test(renderer): Cover tool result pairing`
- `ci: Retry transient PR title validation`
- `chore: address PR 1184 follow-ups` — valid when the request explicitly supplies the issue number.

Invalid:

- `feature: Add undo` — `feature` is not an accepted type; use `feat`.
- `feat: Added undo` — use an imperative subject: `Add undo`.
- `fix Fix stale sessions` — missing the required colon.
- `chore: Various improvements and fixes` — vague; name the outcome.
- `feat: Add undo.` — do not end the subject with punctuation.
- `Feat: add undo` — type must be lowercase and the subject must be
  imperative.

## Required body

Use every section below, in this order. `Results` is optional only when there
is no meaningful before/after metric; all other sections are required.

### Summary

Write one paragraph explaining what the PR does and why it exists. Include the
exact diff-statistics line in this section, using this format:

`**N files changed, +X / −Y**`

Obtain the values from the final diff, not estimation. Run `git diff --stat`
and, when needed to verify insertion/deletion totals, `git diff --numstat`.
Include the exact numbers from those commands, including zeroes where
applicable.

### Results (optional)

Add a before/after table when the PR has measurable impact, such as line
counts, IPC calls, render counts, bundle size, latency, or memory. Omit this
section when no meaningful metric exists; do not manufacture metrics.

### What Changed

List all changes grouped by category. Cover new, modified, deleted, and
renamed files; slices, modules, components, utilities, handlers, migrations,
and documentation updates. Name every new module, slice, component, utility,
or handler and give each a one-line description.

### Architecture

Explain how the changes fit existing architecture, ownership boundaries, and
data flow. Identify the source of truth and relevant process or module
boundaries. Link to relevant `docs/` material when it helps reviewers.

### Testing

List exactly what was run and the result of each command. Use the exact command
text, not “all tests pass.” Select the commands appropriate to the changed
surface; do not claim commands that were not run. Typical repository commands
include:

- `pnpm vitest run <targeted-test-files>`
- `pnpm run check`
- `pnpm run lint`
- `pnpm tsc -p tsconfig.json --noEmit`
- `pnpm tsc -p tsconfig.main.json --noEmit`
- `pnpm tsc -p tsconfig.preload.json --noEmit`
- `pnpm run build`
- `pnpm exec playwright test <targeted-spec> --reporter=line`

Also record manual validation steps, environment details when relevant, and
any intentionally skipped check with its reason.

### What's NOT Changed

State the intentional out-of-scope boundaries. Call out adjacent systems,
APIs, files, migrations, platforms, or user flows that this PR does not alter
so reviewers do not infer unsupported behavior.

### Risk Analysis

Every PR body must include this section. Map every modified component, IPC
handler, state migration, or other meaningful change to a user-facing feature
or operational area. Each listed risk item must include at least one concrete
automated or manual test step. P0 items must be tested before marking the PR
ready for review.

Use the following levels and keep the test step specific:

#### 🔴 P0 — Critical (core user flows affected)

- **Feature or area** — explain what changed and why failure would block a
  core user flow.
  - [ ] Test: exact command, scenario, expected result, and environment.

#### 🟠 P1 — High (important flows affected)

- **Feature or area** — explain the important-flow impact.
  - [ ] Test: exact command or manual scenario and expected result.

#### 🟡 P2 — Medium (secondary flows affected)

- **Feature or area** — explain the secondary-flow impact.
  - [ ] Test: exact command or manual scenario and expected result.

#### 🟢 P3 — Low (minor or cosmetic changes)

- **Feature or area** — explain the limited impact.
  - [ ] Test: exact command or manual scenario and expected result.

If a level has no applicable risks, write `None identified` and explain why.
For fewer than 20 changed files, a simplified list of affected features is
acceptable. For 20 or more changed files, provide the full mapping. For 50 or
more changed files, if the section exceeds roughly 100 lines, put the complete
analysis in a separate pinned PR comment and link it from the body, for
example: `See [Risk Analysis](#issuecomment-XXXX)`.

End the section with this summary table, preserving all four levels:

| Risk Level | Areas | Items |
| --- | --- | --- |
| P0 | Core flows | N |
| P1 | Important flows | N |
| P2 | Secondary flows | N |
| P3 | Minor or cosmetic changes | N |

Replace every `N` with the exact number of risk items in that level.

## Final checks

- Verify the title uses exactly one accepted semantic type and an imperative
  subject.
- Verify the summary's `N`, `+X`, and `−Y` came from the final diff.
- Verify every required body section is present, including `What's NOT
  Changed` and the P0-P3 table.
- Verify every claimed test command was actually run and its result is stated.
- Verify every risk item has a concrete test step and the table counts match.
- Verify no placeholder text, approximate counts, or unverified claims remain.