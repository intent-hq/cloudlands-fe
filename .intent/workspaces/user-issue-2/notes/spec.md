---
id: spec
title: Spec
tags: [spec]
pinned: true
created: "2026-05-07T20:34:03.649Z"
task:
  status: not_started
---

**Goal**: Clicking an attached note/artifact from Intent output opens the intended artifact/note instead of showing “Not Found — Note "pr-17-safety-review" not found in current workspace.”

**Tasks**

- [x] [Diagnose attached artifact link target](intent://local/task/6b6de867-a7ea-421c-892d-5e1236f02ca7)

- [x] [Fix attached note/artifact navigation](intent://local/task/19f4334f-ac68-417d-80ea-a8fa10ac1bd1)

- [x] [Add regression coverage and run targeted checks](intent://local/task/bace4aae-34ce-4ac7-83db-a714f1641169)

**Acceptance Criteria**

- The `PR 17 Safety Review` attachment/link opens the intended note/artifact when it exists.
- The click handler no longer derives a navigation note id from visible title text when a real note id or artifact URI is available.
- Cross-workspace attached note links retain workspace identity when available.
- Existing note/task/file/image link behavior is preserved.
- A regression test covers visible title `PR 17 Safety Review` with a distinct underlying target id.
- Targeted verification commands pass, or any failure is clearly explained with a blocker.

**Non-goals**

- Redesigning the attachment UI.
- Changing the global `intent://` URL scheme beyond preserving correct target metadata.
- Fixing unrelated GitHub YAML parse/truncation errors unless diagnosis proves they directly create the broken attachment link.
- Migrating unrelated deprecated Svelte stores.

**Assumptions**

- The broken click originates from rendered Intent output/ACP content rather than a manually edited note link.
- The intended artifact was either created as a workspace note or has a resource URI that should not be routed as a note.
- The provided debug bundle is representative, even though it does not contain the exact toast text.

**Verification Plan**

- Inspect and run existing tests around `src/lib/utils/workspaces-link-handler.test.ts`, parser tests, and any component tests for `MarkdownViewer` or chat rendering.
- Add a focused regression test for an attachment/link labeled `PR 17 Safety Review` with a non-slug note id or artifact URI.
- Run `pnpm vitest run <targeted-test-files>`.
- Run `pnpm run check` if Svelte components or shared TypeScript contracts are changed.

**Rollback Plan**

- Revert the parser/navigation changes and associated tests. Since the fix should be isolated to rendering/navigation metadata, rollback should not alter persisted workspace notes or artifacts.

## Findings

Diagnosis complete: ACP resource blocks are flattened in `src/features/acp-official/parsers/acp-message-parser.ts`, which loses the display title/resource URI association. That allows a bad title-derived note target such as `pr-17-safety-review` to reach note navigation. Existing classifier/tool-result/workspaces-link-handler tests pass; the new ACP parser regression currently fails until the parser/navigation fix lands.

## Implementation Results

Fix complete: ACP attached note resources now render canonical note links using the persisted note id and workspace from the resource URI. Non-note resources keep the existing resource path. Implementor verification passed: `pnpm vitest run src/features/acp-official/__tests__/acp-message-parser.test.ts` and `pnpm tsc -p tsconfig.json --noEmit`.

## Verification Evidence

Regression task complete: added focused coverage in `src/features/acp-official/__tests__/acp-message-parser.test.ts` for an ACP attached note titled “PR 17 Safety Review” whose target URI uses a distinct note id/workspace. Reported checks: targeted ACP parser test passed; combined link-handler/parser Vitest run passed with 53 tests; `pnpm run check` completed with 0 errors and 259 warnings.

## Final Verification

Verifier approved the implementation with high confidence. Reviewed spec/task notes, commits `015b570d4` and `a7c02b6f7`, ACP parser/test diffs, and link-handler path. Verified commands passed: `pnpm vitest run src/features/acp-official/__tests__/acp-message-parser.test.ts` (22 tests), combined parser/link-handler Vitest suite (53 tests), and `pnpm tsc -p tsconfig.json --noEmit`. No required follow-up found.

## Launch Readiness Follow-up

User requested an additional logic/side-effect review before launch and then PR creation. Focus: ensure ACP attached note resource handling is narrowly scoped, preserves non-note resource behavior, keeps link-handler behavior stable, and passes build-relevant checks before opening the PR.