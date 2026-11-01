import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';
import { includeIgnoreFile } from '@eslint/compat';
import js from '@eslint/js';
import typescript from '@typescript-eslint/eslint-plugin';
import typescriptParser from '@typescript-eslint/parser';
import svelte from 'eslint-plugin-svelte';
import svelteParser from 'svelte-eslint-parser';
import unusedImports from 'eslint-plugin-unused-imports';
import { svelte as themisFullConfig } from '@themislib/themis/eslint-plugins';
import noProductionDynamicImportRule from './eslint-rules/no-production-dynamic-import.js';
import noComponentAsyncDataFetchRule from './eslint-rules/no-component-async-data-fetch.js';
import cssParser from './eslint-rules/design-system/css-parser.js';
import { designSystemRules } from './eslint-rules/design-system/index.js';
import { namedColorAllowlist } from './eslint-rules/design-system/common.js';
import { internalModuleImportPatterns } from './eslint-rules/internal-module-import-patterns.js';
import { baselineCounts, loadBaseline } from './eslint-rules/lib/baseline-ratchet.js';

// One entry file per tolerated source file under eslint-rules/baselines/<rule>/; see
// eslint-rules/lib/baseline-ratchet.js for the layout.
const lintBaseline = loadBaseline({ cwd: fileURLToPath(new URL('.', import.meta.url)) });
const designSystemBaselineOverrides = Object.keys(designSystemRules).flatMap((rule) => {
  const files = (lintBaseline[rule] ?? []).flatMap((exception) => exception.files ?? []);
  return files.length > 0 ? [{ files, rules: { [`intent/${rule}`]: 'off' } }] : [];
});
const semanticColorBaseline = baselineCounts(lintBaseline['no-arbitrary-motion-or-color']) ?? {};
const iconOnlyButtonSizeBaseline = baselineCounts(lintBaseline['icon-only-button-size']) ?? {};
import noColdSvelteImportInTestsRule from './eslint-rules/no-cold-svelte-import-in-tests.js';
import noCopiedChatPanelSelectorMocksRule from './eslint-rules/no-copied-chat-panel-selector-mocks.js';
import noSourceLiteralAssertionsInTestsRule from './eslint-rules/no-source-literal-assertions-in-tests.js';
import noWallClockAssertionsInTestsRule from './eslint-rules/no-wall-clock-assertions-in-tests.js';
import noFakeClockResetBeforeAssertionRule from './eslint-rules/no-fake-clock-reset-before-assertion.js';
import noWallClockInCatalogPreviewsRule, {
  CATALOG_PREVIEW_FILE_GLOBS as catalogPreviewFileGlobs,
  CATALOG_CLOCK_EXEMPT_GLOBS as catalogClockExemptGlobs,
} from './eslint-rules/no-wall-clock-in-catalog-previews.js';
import noClassNameAssertionsInTestsRule from './eslint-rules/no-class-name-assertions-in-tests.js';
import noFlushSyncInTeardownRule from './eslint-rules/no-flushsync-in-teardown.js';
import noRawWorkspaceNavigationRule from './eslint-rules/no-raw-workspace-navigation.js';
import noOneShotAnimationCountRule from './eslint-rules/no-one-shot-animation-count.js';
import noUnarmedOutsideClickInCtRule from './eslint-rules/no-unarmed-outside-click-in-ct.js';
import noRawMouseWheelInCtRule from './eslint-rules/no-raw-mouse-wheel-in-ct.js';
import noWaitForTimeoutInCtRule from './eslint-rules/no-wait-for-timeout-in-ct.js';
import noHandWrittenTypingCheckRule from './eslint-rules/no-hand-written-typing-check.js';
import noScrollIntoViewPrototypeStubRule from './eslint-rules/no-scroll-into-view-prototype-stub.js';
import noFixedWaitTimeoutInTestsRule from './eslint-rules/no-fixed-wait-timeout-in-tests.js';
import requireDisableReasonRule from './eslint-rules/require-disable-reason.js';
import noDirectReducedMotionQueryRule, {
  SOURCE_OF_TRUTH_FILES as reducedMotionSourceOfTruthFiles,
  TEST_FILE_GLOBS as reducedMotionTestFileGlobs,
} from './eslint-rules/no-direct-reduced-motion-query.js';

const sourceLiteralAssertionsBaseline =
  baselineCounts(lintBaseline['no-source-literal-assertions-in-tests']) ?? {};
const wallClockAssertionsBaseline =
  baselineCounts(lintBaseline['no-wall-clock-assertions-in-tests']) ?? {};
const classNameAssertionsBaseline =
  baselineCounts(lintBaseline['no-class-name-assertions-in-tests']) ?? {};
const fixedWaitTimeoutBaseline =
  baselineCounts(lintBaseline['no-fixed-wait-timeout-in-tests']) ?? {};
const waitForTimeoutInCtBaseline = baselineCounts(lintBaseline['no-wait-for-timeout-in-ct']) ?? {};
// The component-test rules whose sanctioned escape hatch is a reasoned single-line disable.
const componentTestReasonedDisableRules = [
  'intent/no-one-shot-animation-count',
  'intent/no-unarmed-outside-click-in-ct',
  'intent/no-raw-mouse-wheel-in-ct',
  'intent/no-wait-for-timeout-in-ct',
];

const intentPlugin = {
  rules: {
    'no-component-async-data-fetch': noComponentAsyncDataFetchRule,
    'no-production-dynamic-import': noProductionDynamicImportRule,
    ...designSystemRules,
    'no-cold-svelte-import-in-tests': noColdSvelteImportInTestsRule,
    'no-copied-chat-panel-selector-mocks': noCopiedChatPanelSelectorMocksRule,
    'no-source-literal-assertions-in-tests': noSourceLiteralAssertionsInTestsRule,
    'no-wall-clock-assertions-in-tests': noWallClockAssertionsInTestsRule,
    'no-fake-clock-reset-before-assertion': noFakeClockResetBeforeAssertionRule,
    'no-wall-clock-in-catalog-previews': noWallClockInCatalogPreviewsRule,
    'no-class-name-assertions-in-tests': noClassNameAssertionsInTestsRule,
    'no-flushsync-in-teardown': noFlushSyncInTeardownRule,
    'no-one-shot-animation-count': noOneShotAnimationCountRule,
    'no-unarmed-outside-click-in-ct': noUnarmedOutsideClickInCtRule,
    'no-raw-mouse-wheel-in-ct': noRawMouseWheelInCtRule,
    'no-wait-for-timeout-in-ct': noWaitForTimeoutInCtRule,
    'no-direct-reduced-motion-query': noDirectReducedMotionQueryRule,
    'no-raw-workspace-navigation': noRawWorkspaceNavigationRule,
    'no-hand-written-typing-check': noHandWrittenTypingCheckRule,
    'no-scroll-into-view-prototype-stub': noScrollIntoViewPrototypeStubRule,
    'no-fixed-wait-timeout-in-tests': noFixedWaitTimeoutInTestsRule,
    'require-disable-reason': requireDisableReasonRule,
  },
};

const themisSourceFiles = ['src/**/*.{js,jsx,mjs,ts,tsx}'];
const themisSelectorFiles = [
  'src/**/*-selector.{js,jsx,mjs,ts,tsx}',
  'src/**/*-selectors.{js,jsx,mjs,ts,tsx}',
];
const themisTestFiles = ['**/*.{test,spec}.{js,jsx,mjs,ts,tsx}'];
const themisSelectorRuleIgnores = [
  '**/__tests__/**/*.{js,jsx,mjs,ts,tsx}',
  '**/tests/**/*.{js,jsx,mjs,ts,tsx}',
  '**/*.{test,spec}.{js,jsx,mjs,ts,tsx}',
  '**/*.manual-test.{js,jsx,mjs,ts,tsx}',
];
const themisSourceSelectorRules = {
  'themis/duplicate-selector-export': 'error',
  'themis/duplicate-selector-implementation': 'error',
  'themis/inline-saga-selector': 'error',
  'themis/direct-selector-call-mode': 'error',
  'themis/wait-for-named-selector': 'error',
};
const themisTestSelectorRuleOverrides = {
  'themis/duplicate-selector-export': 'off',
  'themis/duplicate-selector-implementation': 'off',
  'themis/inline-saga-selector': 'off',
  'themis/direct-selector-call-mode': 'off',
  'themis/wait-for-named-selector': 'off',
  'themis/selector-file-name': 'off',
  'themis/selector-export-name': 'off',
};
const themisTestArchitectureRuleOverrides = {
  'themis/collection-internal-mutation': 'off',
  'themis/create-action-owner': 'off',
  'themis/duplicate-saga-name': 'off',
};
const themisArchitectureRules = {
  'themis/duplicate-action-type': 'error',
  'themis/duplicate-selector-export': 'error',
  'themis/duplicate-selector-implementation': 'error',
  'themis/duplicate-saga-registration': 'error',
  'themis/pass-through-wrapper': 'error',
  'themis/non-serializable-state-type': 'error',
  'themis/non-serializable-initial-state': 'error',
  'themis/nondeterministic-reducer-state': 'error',
  'themis/reducer-side-effect': 'error',
  'themis/async-reducer-handler': 'error',
  'themis/collection-internal-mutation': 'error',
  'themis/inline-saga-selector': 'error',
  'themis/raw-channel-cleanup': 'error',
  'themis/forbidden-redux-api': 'error',
  'themis/create-action-owner': 'error',
  'themis/saga-watcher-action-type': 'error',
  'themis/unnamespaced-action-type': 'error',
  'themis/action-type-shape': 'error',
  'themis/forbidden-component-import': 'error',
};

// Staged rollout: enforce the dynamic-import ban only on files that have already
// been cleaned up. Existing repo-wide violations are intentionally baselined by
// omission until each file is migrated and added here.
const dynamicImportEnforcedFiles = [
  'src/features/accept-changes/main/accept-changes.service.ts',
  'src/features/agent/agent-ipc-bridge.ts',
  'src/features/agent/main/agent-backend-handler.service.ts',
  'src/features/mcp/main/mcp/ws-misc-api.ts',
  'src/features/mcp/main/mcp/ws-note-api.ts',
  'src/features/mcp/main/mcp/ws-workspace-api.ts',
  'src/features/mcp/main/user-mcp-settings.ts',
  'src/main/http-mcp-bridge.ts',
];

const productionModuleIgnores = [
  '**/__tests__/**',
  '**/tests/**',
  '**/*.test.{js,jsx,ts,tsx,svelte}',
  '**/*.spec.{js,jsx,ts,tsx,svelte}',
  '**/*.generated.{js,jsx,ts,tsx,svelte}',
  '**/generated/**',
];

// The only production files allowed to read the raw
// `metadata.dismissedQuestionsMessageId` wire field. Every other surface must go
// through `isQuestionMessageDismissed` / `sessionHasPendingQuestion` so the
// dismissal comparison is never hand-rolled again (intent-hq/cloudlands-fe#2316).
const dismissalMarkerRawReadAllowedFiles = [
  // Canonical dismissal predicate.
  'src/shared/utils/question-dismissal.ts',
  // Session metadata normalisation on the wire boundary.
  'src/store/renderer/slices/agent-session/agent-session-slice.ts',
  // `questions_dismissed` system-row payload parsing.
  'src/lib/components/chat/questions-dismissed-notice.ts',
  // `void …dismissedQuestionsMessageId` Svelte reactivity touches only.
  'src/lib/components/chat/AgentCard.svelte',
  'src/lib/components/chat/ChatPanel.svelte',
];
const dismissalMarkerRawReadMessage =
  'Do not read `dismissedQuestionsMessageId` directly. Use `isQuestionMessageDismissed` (src/shared/utils/question-dismissal.ts) or `sessionHasPendingQuestion` (src/lib/components/chat/questions/pending-questions.ts) so the dismissal comparison stays shared.';
const dismissalMarkerRawReadSelectors = [
  {
    selector: "MemberExpression[computed=false][property.name='dismissedQuestionsMessageId']",
    message: dismissalMarkerRawReadMessage,
  },
  {
    selector: "MemberExpression[computed=true][property.value='dismissedQuestionsMessageId']",
    message: dismissalMarkerRawReadMessage,
  },
  {
    selector: "ObjectPattern > Property[key.name='dismissedQuestionsMessageId']",
    message: dismissalMarkerRawReadMessage,
  },
  {
    selector: "ObjectPattern > Property[key.value='dismissedQuestionsMessageId']",
    message: dismissalMarkerRawReadMessage,
  },
];

// Host modules the shared root layout must not reach (see the
// src/routes/+layout.svelte override below). `no-restricted-imports` covers
// static imports only, so dynamic `import()` of the same modules is banned
// through `no-restricted-syntax`; the specifier must be a string literal so
// the ban can be checked at all.
const rootLayoutHostModules = [
  ['electron-bridge', 'reach the Electron bridge'],
  ['live-app-client', 'construct the live daemon client'],
  ['mock-bootstrap', 'seed the browser mock store'],
];
const rootLayoutDynamicImportSelectors = [
  ...rootLayoutHostModules.map(([basename, action]) => ({
    selector: `ImportExpression[source.type='Literal'][source.value=/${basename}(\\.[jt]s)?$/]`,
    message: `The root layout is shared with the /sandbox catalog and must not ${action}, statically or via import(). Host wiring belongs in src/routes/(app)/+layout.svelte.`,
  })),
  {
    selector: "ImportExpression[source.type!='Literal']",
    message:
      'Dynamic imports in the shared root layout must use a string-literal specifier so the host-module boundary can be lint-checked.',
  },
];

// Staged rollout: existing components with direct async data loads are baselined
// until each flow moves to Redux actions/selectors. New Svelte components and
// cleaned-up files are checked by the rule below.
const componentAsyncDataFetchBaselineFiles = [
  'src/features/layout/tab-types/ActivityChangesTabType.svelte',
  'src/features/layout/tab-types/AgentTabType.svelte',
  'src/features/layout/tab-types/ChangesTabType.svelte',
  'src/features/layout/tab-types/DiffTabType.svelte',
  'src/features/layout/tab-types/FileTabType.svelte',
  'src/features/layout/tab-types/NoteTabType.svelte',
  'src/features/onboarding/messages/AgentGrid.svelte',
  'src/features/onboarding/messages/GitHubRepoTab.svelte',
  'src/features/onboarding/messages/LocalRepoTab.svelte',
  'src/features/onboarding/messages/NewProjectTab.svelte',
  'src/features/onboarding/messages/ProviderCard.svelte',
  'src/features/onboarding/messages/ProjectPickerMessage.svelte',
  'src/features/onboarding/OnboardingPage.svelte',
  'src/features/onboarding/steps/OnboardingPromptStep.svelte',
  'src/features/onboarding/steps/WorkspaceCreationError.svelte',
  'src/features/workspace/SpacesSwitcherOverlay.svelte',
  'src/lib/components/AuggieSetupGate.svelte',
  'src/lib/components/CommandPalette.svelte',
  'src/lib/components/GitCredentialsModal.svelte',
  'src/lib/components/GitHubAuthBanner.svelte',
  'src/lib/components/GitHubAuthModal.svelte',
  'src/lib/components/PromotionalBanner.svelte',
  'src/lib/components/browser/EmbeddedBrowser.svelte',
  'src/lib/components/chat/AgentCard.svelte',
  'src/lib/components/chat/AgentStreamHandler.svelte',
  'src/lib/components/chat/AgentSubscriptions.svelte',
  'src/lib/components/chat/ChatChangesPanel.svelte',
  'src/lib/components/chat/ChatDiffViewer.svelte',
  'src/lib/components/chat/ChatMessage.svelte',
  'src/lib/components/chat/ChatPanel.svelte',
  'src/lib/components/chat/MessageActions.svelte',
  'src/lib/components/chat/MessageContent.svelte',
  'src/lib/components/chat/StreamingMessageContent.svelte',
  'src/lib/components/chat/input/ContextPickerButton.svelte',
  'src/lib/components/chat/input/EnhancedMentionList.svelte',
  'src/lib/components/chat/input/ModelPicker.svelte',
  'src/lib/components/chat/input/SimpleRichInput.svelte',
  'src/lib/components/chat/input/TipTapEditor.svelte',
  'src/lib/components/chat/proposals/ProposalCard.svelte',
  'src/lib/components/code-review/CodeReviewPanel.svelte',
  'src/lib/components/code-review/ReviewCommentCard.svelte',
  'src/lib/components/code-review/walkthrough/CodeWalkthroughSection.svelte',
  'src/lib/components/debug/DebugPanel.svelte',
  'src/lib/components/diagrams/DiagramEdge.svelte',
  'src/lib/components/editor/CodeEditor.svelte',
  'src/lib/components/editor/FileViewer.svelte',
  'src/lib/components/editor/MarkdownRenderer.svelte',
  'src/lib/components/error/EnhancedErrorBoundary.svelte',
  'src/lib/components/file-explorer/VirtualizedFileTree.svelte',
  'src/lib/components/file-explorer/file-explorer-layout.svelte',
  'src/lib/components/file-explorer/file-tree-view.svelte',
  'src/lib/components/layout/WindowTitleBar.svelte',
  'src/lib/components/layout/panel-system/PanelLayout.svelte',
  'src/lib/components/layout/panel-system/PanelTabBar.svelte',
  'src/lib/components/layout/sidebar-nav/SidebarNav.svelte',
  'src/lib/components/markdown/MarkdownViewer.svelte',
  'src/lib/components/markdown/MermaidRenderer.svelte',
  'src/lib/components/modals/FeatureCodeDialog.svelte',
  'src/lib/components/modals/PullConflictDialog.svelte',
  'src/lib/components/notes/primitives/AgentActionBlock.svelte',
  'src/lib/components/notes/primitives/CliBlock.svelte',
  'src/lib/components/notes/primitives/DiagramBlock.svelte',
  'src/lib/components/notes/primitives/PatchBlock.svelte',
  'src/lib/components/notes/primitives/ReferenceBlock.svelte',
  'src/lib/components/settings/AIBehaviorEditor.svelte',
  'src/lib/components/settings/AdditionalAgentsSettings.svelte',
  'src/lib/components/settings/AgentBackendSettings.svelte',
  'src/lib/components/settings/AgentRulesEditor.svelte',
  'src/lib/components/settings/ColorThemeSettings.svelte',
  'src/lib/components/settings/GitWorkspaceSettings.svelte',
  'src/lib/components/settings/LinearAuthConnection.svelte',
  'src/lib/components/settings/McpServersSettings.svelte',
  'src/lib/components/settings/ProviderPathConfig.svelte',
  'src/lib/components/settings/ProviderSelector.svelte',
  'src/lib/components/settings/RtkSettings.svelte',
  'src/lib/components/settings/SentryAuthConnection.svelte',
  'src/lib/components/terminal/QuakeTerminalOverlay.svelte',
  'src/lib/components/terminal/ScriptOutputViewer.svelte',
  'src/lib/components/terminal/SetupScriptBanner.svelte',
  'src/lib/components/terminal/Terminal.svelte',
  'src/lib/components/terminal/TerminalSidebar.svelte',
  'src/lib/components/tiptap/BubbleMenu.svelte',
  'src/lib/components/tiptap/CommentsSidebar.svelte',
  'src/lib/components/tiptap/ContextMentionNodeView.svelte',
  'src/lib/components/tiptap/TaskAgentStatus.svelte',
  'src/lib/components/tiptap/TaskItemNodeView.svelte',
  'src/lib/components/tiptap/TaskMenu.svelte',
  'src/lib/components/ui/CopyButton.svelte',
  'src/features/external-editors/components/FileActionsDropdown.svelte',
  'src/features/external-editors/components/OpenComboButton.svelte',
  'src/lib/components/ui/VirtualList.svelte',
  'src/features/workspace/components/WorkspaceActionsMenu.svelte',
  'src/features/file-tracking/components/diff/TrackedChangeDiffViewer.svelte',
  'src/lib/components/ui/searchable-combobox/searchable-combobox.svelte',
  'src/lib/components/ui/searchable-select/searchable-select.svelte',
  'src/lib/components/visualization/repo-visualizer/RepoVisualizer.svelte',
  'src/lib/components/visualization/repo-visualizer/TreeCanvas.svelte',
  'src/lib/components/workspace/CompactWorkspaceInitializer.svelte',
  'src/lib/components/workspace/MultiSelectTabbedSidebar.svelte',
  'src/lib/components/workspace/NoteCodeChangesCard.svelte',
  'src/lib/components/workspace/NoteMetadataBar.svelte',
  'src/lib/components/workspace/NoteWithComments.svelte',
  'src/lib/components/workspace/PullRequestCreator.svelte',
  'src/lib/components/workspace/SpecWritingOnboarding.svelte',
  'src/lib/components/workspace/WorkspaceAgentsList.svelte',
  'src/lib/components/workspace/WorkspaceHoverCard.svelte',
  'src/lib/components/workspace/WorkspaceLinks.svelte',
  'src/lib/components/workspace/WorkspaceSidebarHeader.svelte',
  'src/lib/components/workspace/WorkspaceTableView.svelte',
  'src/lib/components/workspace/initializer/AddRemoteSetupModal.svelte',
  'src/lib/components/workspace/initializer/BranchSelector.svelte',
  'src/lib/components/workspace/initializer/InitialAgentPicker.svelte',
  'src/lib/components/workspace/initializer/IssueSuggestions.svelte',
  'src/lib/components/workspace/initializer/RepoSelector.svelte',
  'src/lib/components/workspace/initializer/SetupScriptAgent.svelte',
  'src/lib/components/workspace/sidebar/BranchDisplay.svelte',
  'src/lib/components/workspace/sidebar/CommitsTimeline.svelte',
  'src/lib/components/workspace/sidebar/CommitDrawer.svelte',
  'src/lib/components/workspace/sidebar/ContextPanel.svelte',
  'src/lib/components/workspace/sidebar/FileChangesSection.svelte',
  'src/lib/components/workspace/sidebar/FilesPanel.svelte',
  'src/lib/components/workspace/sidebar/MergePanel.svelte',
  'src/lib/components/workspace/sidebar/PRSection.svelte',
  'src/lib/components/workspace/sidebar/PostMergeActions.svelte',
  'src/lib/components/workspace/sidebar/SidebarChangesPanel.svelte',
  'src/lib/components/workspace/sidebar/WorkspaceProgressCard.svelte',
  'src/lib/components/workspace/sidebar/context-picker/LinearPicker.svelte',
  'src/lib/components/workspace/sidebar/context-picker/SentryPicker.svelte',
  'src/routes/(app)/+layout.svelte',
  'src/routes/(app)/agent/[id]/+page.svelte',
  'src/routes/observability/+page.svelte',
  'src/routes/(app)/settings/+page.svelte',
  'src/routes/(app)/test-comments/+page.svelte',
  'src/routes/(app)/test-error-boundary/+page.svelte',
  'src/routes/(app)/test-input/+page.svelte',
  'src/routes/(app)/test-mentions/+page.svelte',
  'src/routes/(app)/test-mentions/compact/+page.svelte',
  'src/routes/(app)/workspace/[id]/+page.svelte',
];

const componentAsyncDataFetchBaselineIgnorePatterns = componentAsyncDataFetchBaselineFiles.map(
  (file) => file.replaceAll('[', '\\[').replaceAll(']', '\\]'),
);

// Browser safety: renderer code (src/lib, src/routes, src/store, feature roots)
// must never import Electron, Node builtins, or main-process (`**/main/**`)
// subtrees — it has to stay runnable in a plain browser context. Type-only
// imports are allowed because they are erased at compile time. See
// the monorepo's docs/fe/MODULE_BOUNDARY_GUIDE.md.
//
// Staged rollout: the files below are pre-existing violators — mostly
// main-process code living at a feature root instead of a `main/` subtree,
// plus Node-dependent agent-test harness code. They are baselined by omission.
// TODO: migrate each file (relocate into a `main/` subtree or make it
// browser-safe) and remove it from this list.
const rendererBrowserSafetyBaselineFiles = [
  'src/features/agent/agent-context.ipc.ts',
  'src/features/agent/testing/agent-test-harness.ts',
  'src/features/agent/testing/agent-test-runner.ts',
  'src/features/agent/testing/agent-test-utils.ts',
  'src/features/agent/testing/prompt-loader.ts',
  'src/features/cdp/index.ts',
  'src/features/cdp/tools/get-console-logs-tool.ts',
  'src/features/cdp/tools/get-dom-tool.ts',
  'src/features/cdp/tools/hello-cdp-tool.ts',
  'src/features/cdp/tools/run-script-tool.ts',
  'src/features/cortex/cortex-acp/cortex-acp.ts',
  'src/features/deeplink/deep-link-handler.ts',
  'src/features/diffs/diffs.service.ts',
  'src/features/error-handling/recovery-manager.ts',
  'src/features/git-tracking/git-state-manager-registry.ts',
  'src/features/ipc/ipc-validation.ts',
  'src/features/mcp/mcp-bridge.ts',
  'src/features/mcp/servers/git/index.ts',
  'src/features/mcp/servers/notes/index.ts',
  'src/features/mcp/servers/workspace/index.ts',
  'src/features/performance/memory-monitor.ts',
  'src/features/tools/index.ts',
];

const nodeBuiltinModules = [...new Set(builtinModules.map((name) => name.replace(/^node:/, '')))];

// Electron main-process source globs shared by the main-process-only rule blocks.
const mainProcessFiles = [
  'src/main/**/*.ts',
  'src/features/*/main/**/*.ts',
  'src/shared/main/**/*.ts',
  'src/shared/git/**/*.ts',
];

// Shared options for the renderer browser-safety no-restricted-imports rule;
// applied at `error` to clean files and `warn` to the baselined files below so
// new violations in baselined files stay visible while migration proceeds.
const rendererBrowserSafetyRestrictedImportsOptions = {
  paths: [
    {
      name: 'electron',
      message:
        'Renderer code must stay browser-safe: Electron is only available in the main process. Route through IPC/preload instead (docs/fe/MODULE_BOUNDARY_GUIDE.md).',
      allowTypeImports: true,
    },
  ],
  patterns: [
    {
      regex: '^electron/',
      message:
        'Renderer code must stay browser-safe: Electron is only available in the main process. Route through IPC/preload instead (docs/fe/MODULE_BOUNDARY_GUIDE.md).',
      allowTypeImports: true,
    },
    {
      regex: `^(node:)?(${nodeBuiltinModules.join('|')})(/|$)`,
      message:
        'Renderer code must stay browser-safe: Node builtins are not available in the browser. Move the logic to the main process or use a browser-safe alternative (docs/fe/MODULE_BOUNDARY_GUIDE.md).',
      allowTypeImports: true,
    },
    {
      regex: '(^|/)main(/|$)',
      message:
        'Renderer code must never import from a main/ subtree. Extract a shared/browser-safe module or route through IPC instead (docs/fe/MODULE_BOUNDARY_GUIDE.md).',
      allowTypeImports: true,
    },
  ],
};

// The shared CT-module restriction (see the `no-restricted-imports` block
// below); also repeated by per-file `no-restricted-imports` overrides, since
// flat-config rule entries replace rather than merge.
const ctSharedModuleRestrictedImportPath = {
  name: '@playwright/experimental-ct-svelte',
  allowTypeImports: true,
  message:
    "Only type imports may come from '@playwright/experimental-ct-svelte'. Import `test` / `expect` (and any other runtime export) from the shared CT module (src/test/ct-test.ts) so the browser-context isolation applies to this spec.",
};

const javascriptConfig = {
  files: ['**/*.js', '**/*.jsx', '**/*.mjs'],
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    globals: {
      console: 'readonly',
      process: 'readonly',
      Buffer: 'readonly',
      __dirname: 'readonly',
      __filename: 'readonly',
      global: 'readonly',
      window: 'readonly',
      document: 'readonly',
      navigator: 'readonly',
      fetch: 'readonly',
      URL: 'readonly',
      URLSearchParams: 'readonly',
      setTimeout: 'readonly',
      clearTimeout: 'readonly',
      setInterval: 'readonly',
      clearInterval: 'readonly',
      Promise: 'readonly',
      require: 'readonly',
      module: 'readonly',
      exports: 'readonly',
      WebSocket: 'readonly',
      MutationObserver: 'readonly',
      PerformanceObserver: 'readonly',
      Event: 'readonly',
      KeyboardEvent: 'readonly',
      getComputedStyle: 'readonly',
      performance: 'readonly',
      requestAnimationFrame: 'readonly',
      cancelAnimationFrame: 'readonly',
      queueMicrotask: 'readonly',
      HTMLAnchorElement: 'readonly',
      HTMLElement: 'readonly',
      Element: 'readonly',
      Node: 'readonly',
    },
  },
  plugins: {
    'unused-imports': unusedImports,
  },
  rules: {
    ...js.configs.recommended.rules,
    'no-console': 'off',
    'prefer-const': 'warn',
    'no-var': 'error',
    'object-shorthand': 'off',
    'prefer-template': 'off',
    'prefer-arrow-callback': 'off',
    'no-unused-vars': [
      'error',
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
      },
    ],
    'unused-imports/no-unused-imports': 'error',
  },
};

export default [
  // .gitignore is the source of truth for scratch/sandbox exclusions (.dev/, .wt-*/); see vitest.config.ts.
  includeIgnoreFile(fileURLToPath(new URL('.gitignore', import.meta.url))),
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.svelte-kit/**',
      '**/*.min.js',
      '**/*.min.css',
      '**/docs-archive-*/**',
      '**/cdp-mcp-server/dist/**',
      '**/test-reports/**',
      '**/logs/**',
      '**/*.log',
      '**/src/shared/generated/**',
      '**/src/shared/paraglide/**',
      '**/static/generated/**',
      '**/.backup-state-migration/**',
      '**/.test-data/**',
      '**/cdp-mcp-server/**',
      '**/playwright/.cache/**',
      '**/playwright-report/**',
      '**/e2e/**',
      '**/test/**',
    ],
  },
  javascriptConfig,
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        global: 'readonly',
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        Promise: 'readonly',
        WebSocket: 'readonly',
        MutationObserver: 'readonly',
        PerformanceObserver: 'readonly',
        Event: 'readonly',
        KeyboardEvent: 'readonly',
        getComputedStyle: 'readonly',
        performance: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        queueMicrotask: 'readonly',
        HTMLAnchorElement: 'readonly',
        HTMLElement: 'readonly',
        Element: 'readonly',
        Node: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': typescript,
      'unused-imports': unusedImports,
    },
    rules: {
      ...typescript.configs.recommended.rules,
      'no-console': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
      'unused-imports/no-unused-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/no-unsafe-function-type': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      'prefer-const': 'warn',
      'no-var': 'error',
      'object-shorthand': 'off',
      'prefer-template': 'off',
      'prefer-arrow-callback': 'off',
    },
  },
  // Scripts run under Node only. The shared JS/TS blocks above declare the
  // globals renderer and main code have in common; the Node-only ones live here.
  {
    files: ['scripts/**/*.{js,cjs,mjs,ts}'],
    languageOptions: {
      globals: {
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        clearImmediate: 'readonly',
        setImmediate: 'readonly',
        structuredClone: 'readonly',
        TextDecoder: 'readonly',
        TextEncoder: 'readonly',
      },
    },
  },
  {
    ...javascriptConfig,
    files: ['scripts/**/*.cjs'],
    languageOptions: {
      ...javascriptConfig.languageOptions,
      sourceType: 'commonjs',
    },
  },
  {
    files: dynamicImportEnforcedFiles,
    ignores: productionModuleIgnores,
    plugins: {
      intent: intentPlugin,
    },
    rules: {
      'intent/no-production-dynamic-import': 'error',
    },
  },
  // A dynamic `.svelte` import inside a test body bills the component's whole
  // cold module-graph transform to the first test's timeout, producing
  // load-dependent timeout flakes (intent-hq/intent#1464). Warm the specifier
  // at module scope (warmImport / static import) so test bodies hit the cache.
  {
    files: ['**/*.{test,spec}.{js,ts}'],
    plugins: {
      intent: intentPlugin,
    },
    rules: {
      'intent/no-cold-svelte-import-in-tests': 'error',
      'intent/no-copied-chat-panel-selector-mocks': 'error',
      // A test that reads a .svelte/.ts source file from disk to assert on its
      // text pins the test to how the source is spelled, not what it does
      // (cloudlands-fe#2760). The baseline maps today's offenders to their
      // read counts and may only shrink: lower a file's count as reads are
      // fixed (delete its entry file at zero), never raise one or add a file.
      'intent/no-source-literal-assertions-in-tests': [
        'error',
        { baseline: sourceLiteralAssertionsBaseline },
      ],
      // A test that asserts a raw performance.now()/Date.now() elapsed time
      // against a millisecond budget passes in isolation and fails under CI
      // runner load (cloudlands-fe#2740). Same ratchet as above: the baseline
      // maps today's offenders to their assertion counts and may only shrink.
      'intent/no-wall-clock-assertions-in-tests': [
        'error',
        { baseline: wallClockAssertionsBaseline },
      ],
      // A test that pins a fake clock with vi.setSystemTime and then calls
      // vi.clearAllTimers() / vi.useRealTimers() before asserting reads the real time
      // of day, so it passes or fails depending on when CI runs (cloudlands-fe#3574
      // was ejected from the merge queue after 08:00 UTC). No baseline: enforced at zero.
      'intent/no-fake-clock-reset-before-assertion': 'error',
    },
  },
  // A component test that counts getAnimations() once and expects zero fails at random
  // when a child component is mid-way through a short, normal fade (cloudlands-fe#3651
  // was ejected from the merge queue by the IntentMarkLoader's 160 ms crossfade;
  // intent-hq/intent#7749). Use expectAnimationsToSettle / expectNoAnimations from
  // src/test/ct-test.ts. No baseline: enforced at zero.
  //
  // An outside click sent as soon as a bits-ui menu, popover, select or dialog is visible
  // can arrive before bits-ui's afterSleep(1) registers its outside-pointer listeners, so
  // the layer stays open at random (cloudlands-fe#3696 failed 3 of 20 runs). Wait with
  // expectDismissibleLayerArmed from src/test/dismissible-layer.ts. No baseline.
  //
  // A single page.mouse.wheel can be dropped when Chromium routes it by a stale compositor
  // frame, so the element never scrolls (cloudlands-fe#3733 failed 4 of 320 runs;
  // cloudlands-fe#3516, intent-hq/intent#7255). Use wheelUntilScrolled from
  // src/test/ct-test.ts; a wheel that must not scroll disables the rule on its line with a
  // reason. No baseline.
  //
  // A fixed page.waitForTimeout guesses how long motion takes; on a slow runner the next
  // click lands mid-animation and is dropped because Playwright hit-tests only pointerdown
  // (cloudlands-fe#3955; the flake ejected cloudlands-fe#3920 from the merge queue). Use
  // clickAndSettle / expectMotionToSettle from src/test/ct-test.ts. The baseline maps
  // today's specs to their sleep counts and may only shrink.
  //
  // Each of these rules accepts a single-line eslint-disable with a reason as its escape
  // hatch; intent/require-disable-reason checks that the directive gives one.
  {
    files: ['src/**/*.ct.spec.ts'],
    plugins: {
      intent: intentPlugin,
    },
    rules: {
      'intent/no-one-shot-animation-count': 'error',
      'intent/no-unarmed-outside-click-in-ct': 'error',
      'intent/no-raw-mouse-wheel-in-ct': 'error',
      'intent/no-wait-for-timeout-in-ct': ['error', { baseline: waitForTimeoutInCtBaseline }],
      'intent/require-disable-reason': ['error', { rules: componentTestReasonedDisableRules }],
    },
  },
  // Testing Library waits and vi.waitFor / vi.waitUntil default to half the CI-scaled test
  // budget (src/test-setup.ts; 15 s locally, 30 s on CI). The fixed 3-5 s limits tests added
  // to get past the old 1 s default are stricter than that on CI (cloudlands-fe#3958,
  // #3964). The baseline lists the deliberate cases with their owner and reason; counts
  // only shrink. A reasoned single-line eslint-disable is the other escape hatch, and
  // intent/require-disable-reason checks that it gives the reason.
  {
    files: ['**/*.test.{js,mjs,cjs,ts}'],
    plugins: {
      intent: intentPlugin,
    },
    rules: {
      'intent/no-fixed-wait-timeout-in-tests': ['error', { baseline: fixedWaitTimeoutBaseline }],
      'intent/require-disable-reason': [
        'error',
        { rules: ['intent/no-fixed-wait-timeout-in-tests'] },
      ],
    },
  },
  // A unit test that asserts an element's className / classList / class attribute pins
  // how a style is spelled, not what the user sees (cloudlands-fe#3463; AGENTS.md "Do
  // not write decorative appearance tests"). The baseline maps today's offenders to their
  // assertion counts and may only shrink. A reasoned single-line eslint-disable is the
  // other escape hatch, and intent/require-disable-reason checks that it gives the reason.
  {
    files: ['src/**/*.test.ts'],
    plugins: {
      intent: intentPlugin,
    },
    rules: {
      'intent/no-class-name-assertions-in-tests': [
        'error',
        { baseline: classNameAssertionsBaseline },
      ],
      // These files also match the block above, and a later block's options replace an
      // earlier block's, so this list names both rules.
      'intent/require-disable-reason': [
        'error',
        {
          rules: [
            'intent/no-fixed-wait-timeout-in-tests',
            'intent/no-class-name-assertions-in-tests',
          ],
        },
      ],
    },
  },
  // jsdom has no Element.prototype.scrollIntoView; src/test-setup.ts installs the shared
  // no-op (cloudlands-fe#3921). About thirty test files had kept their own prototype stub,
  // and new tests copied the pattern. Spy with vi.spyOn instead. No baseline.
  {
    files: ['src/**/*.{js,mjs,ts}'],
    ignores: ['src/test-setup.ts'],
    plugins: {
      intent: intentPlugin,
    },
    rules: {
      'intent/no-scroll-into-view-prototype-stub': 'error',
    },
  },
  // Ban synchronous child_process calls in Electron main process code.
  // execSync/spawnSync block the main thread and can freeze the entire UI
  // if the spawned process hangs (see: hang report 2026-02-28).
  // Use execAsync (promisified exec) or spawn instead.
  {
    files: mainProcessFiles,
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'child_process',
              importNames: ['execSync', 'spawnSync', 'execFileSync'],
              message:
                'Synchronous child_process calls block the Electron main thread. Use exec/spawn with util.promisify or the execAsync helper instead.',
            },
          ],
        },
      ],
    },
  },
  // Every Playwright CT spec and CT helper takes `test` / `expect` from the shared
  // module, which turns off ct-core's per-worker browser-context reuse (the
  // reuse reset raced `mount()` on the merge queue: intent-hq/intent#4373, #4783,
  // #5236, #5249, #5279, #5481). A spec that imports them from the package
  // directly runs without that override, so forbid every value import of the
  // package — named, namespace (`import * as ct`) and default alike; an
  // `importNames` list would let `ct.test` / `ct.expect` through a default import.
  // Type imports (`Locator`, `Page`, `ComponentFixtures`, ...) still come from the
  // package. The shared module itself is the one sanctioned value importer.
  // Main-process files are excluded so this block does not replace their
  // child_process ban above.
  {
    files: ['src/**/*.{js,mjs,ts,tsx,svelte}'],
    ignores: ['src/test/ct-test.ts', ...mainProcessFiles],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [ctSharedModuleRestrictedImportPath],
        },
      ],
    },
  },
  // ModelPicker reaches the agent-session mutation APIs (`agent.setModel`, the
  // session `model` write, the reasoning-effort writers) only through the
  // lock-checking funnel in agent-model-mutator.ts, so a guest-locked picker
  // cannot issue a write by construction. Four heads / three fix rounds were
  // needed to find every per-boundary re-check in cloudlands-fe#2735; this
  // keeps a new dispatch path from bypassing the mutator. The shared CT-module
  // path is repeated so this override does not drop that restriction.
  // `no-restricted-imports` compares source strings and never resolves modules,
  // so `paths` would only ban the exact alias spelling: each gitignore-style
  // `patterns` group below comes from the shared
  // eslint-rules/internal-module-import-patterns.js helper, which also covers
  // the relative form (`../../../../features/...`) and the `.ts` / `.js`
  // extension spellings of each protected module (cloudlands-fe#2763 review).
  // Each group bans the whole module rather than named exports: an
  // `importNames` list still lets a namespace import (`import * as m`) reach
  // the same binding as `m.agentClient`. ModelPicker imports nothing else from
  // these modules, so nothing needs allowImportNames.
  // src/lib/eslint/__tests__/model-picker-import-restriction.test.ts asserts
  // the matrix against this effective config.
  {
    files: ['src/lib/components/chat/input/ModelPicker.svelte'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [ctSharedModuleRestrictedImportPath],
          patterns: [
            {
              group: internalModuleImportPatterns('$features', 'features/agent/agent.client'),
              message:
                'ModelPicker must not call agentClient.setModel directly. Route the write through the lock-checking mutator in src/lib/components/chat/input/agent-model-mutator.ts (createAgentModelMutator).',
            },
            {
              group: internalModuleImportPatterns('$features', 'features/agent/reasoning-effort'),
              message:
                'ModelPicker must not call applyReasoningEffort / reconcileAgentReasoningEffort directly. Route the write through the lock-checking mutator in src/lib/components/chat/input/agent-model-mutator.ts (createAgentModelMutator).',
            },
            {
              group: internalModuleImportPatterns(
                '$store',
                'store/renderer/slices/agent-session/agent-session-slice',
              ),
              message:
                'ModelPicker must not dispatch the agent-session updateSession action directly. Route the write through the lock-checking mutator in src/lib/components/chat/input/agent-model-mutator.ts (createAgentModelMutator).',
            },
          ],
        },
      ],
    },
  },
  // The root layout is shared by the product app shell and the /sandbox component
  // catalog: it starts the store lifecycle and loads the global stylesheet, and
  // nothing more. Host code — the Electron bridge, the live daemon client, the
  // browser mock-store seeding — belongs to the (app) layout, so a catalog page
  // never boots a daemon connection or the mock bootstrap. The shared CT-module
  // path is repeated so this override does not drop that restriction;
  // src/lib/component-catalog/catalog-shell.test.ts asserts the matrix against
  // this effective config. The matching dynamic-import ban rides on
  // `no-restricted-syntax` in the root-layout block after the
  // dismissedQuestionsMessageId guard below, so that guard does not override it.
  {
    files: ['src/routes/+layout.svelte'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [ctSharedModuleRestrictedImportPath],
          patterns: [
            {
              group: internalModuleImportPatterns('$lib', 'lib/electron-bridge'),
              message:
                'The root layout is shared with the /sandbox catalog and must not reach the Electron bridge. Host wiring belongs in src/routes/(app)/+layout.svelte.',
            },
            {
              group: internalModuleImportPatterns('$lib', 'lib/client/live/live-app-client'),
              message:
                'The root layout is shared with the /sandbox catalog and must not construct the live daemon client. Host wiring belongs in src/routes/(app)/+layout.svelte.',
            },
            {
              group: internalModuleImportPatterns('$store', 'store/renderer/mock-bootstrap'),
              message:
                'The root layout is shared with the /sandbox catalog and must not seed the browser mock store. Host wiring belongs in src/routes/(app)/+layout.svelte.',
            },
          ],
        },
      ],
    },
  },
  // Type-aware lint for Electron main-process + preload code. An unawaited
  // promise inside a try/catch silently succeeds: the Electron 42→44 bump made
  // `clipboard.writeText()` async and the WRITE_CLIPBOARD handler kept
  // returning `{ success: true }` without observing the write
  // (cloudlands-fe#2164, fixed in cloudlands-fe#2493). Files are typed against
  // the main tsconfig and a lint-only preload project: the shipped
  // src/preload/index.ts is generated and gitignored (so globally ignored above),
  // and tsconfig.preload.json excludes the tracked template to keep it out of the
  // build, so tsconfig.preload.lint.json type-checks the template instead. Both
  // tsconfigs exclude tests, so tests are excluded here too; renderer/Svelte
  // linting stays syntax-only.
  {
    files: [...mainProcessFiles, 'src/preload/**/*.ts'],
    ignores: ['**/__tests__/**', '**/*.test.ts'],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.preload.lint.json', './tsconfig.main.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },
  // Guard raw `dismissedQuestionsMessageId` reads: the dismissal comparison lives
  // in the shared helpers only. See dismissalMarkerRawReadAllowedFiles above.
  {
    files: ['src/**/*.{js,mjs,ts,tsx,svelte}'],
    ignores: [...productionModuleIgnores, ...dismissalMarkerRawReadAllowedFiles],
    rules: {
      'no-restricted-syntax': ['error', ...dismissalMarkerRawReadSelectors],
    },
  },
  // Root-layout dynamic-import ban (see the `no-restricted-imports` override
  // above). Placed after the `src/**` `no-restricted-syntax` block because flat
  // config replaces a rule's options per file rather than merging them, so this
  // block carries the dismissal selectors too.
  {
    files: ['src/routes/+layout.svelte'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...dismissalMarkerRawReadSelectors,
        ...rootLayoutDynamicImportSelectors,
      ],
    },
  },
  // Browser safety for renderer code: no Electron, no Node builtins, no
  // main-process subtrees. See the monorepo's docs/fe/MODULE_BOUNDARY_GUIDE.md and the
  // rendererBrowserSafetyBaselineFiles comment above.
  {
    files: [
      'src/lib/**/*.{js,mjs,ts,tsx,svelte}',
      'src/routes/**/*.{js,mjs,ts,tsx,svelte}',
      'src/store/**/*.{js,mjs,ts,tsx,svelte}',
      'src/features/**/*.{js,mjs,ts,tsx,svelte}',
    ],
    ignores: ['src/**/main/**', ...productionModuleIgnores, ...rendererBrowserSafetyBaselineFiles],
    plugins: {
      '@typescript-eslint': typescript,
    },
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        rendererBrowserSafetyRestrictedImportsOptions,
      ],
    },
  },
  // Baselined pre-existing violators get the same rule at `warn` severity so
  // new browser-unsafe imports remain visible (instead of zero enforcement by
  // omission) while each file is migrated off the baseline list.
  {
    files: rendererBrowserSafetyBaselineFiles,
    ignores: productionModuleIgnores,
    plugins: {
      '@typescript-eslint': typescript,
    },
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'warn',
        rendererBrowserSafetyRestrictedImportsOptions,
      ],
    },
  },
  {
    files: ['**/*.svelte'],
    languageOptions: {
      parser: svelteParser,
      parserOptions: {
        parser: typescriptParser,
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    plugins: {
      svelte,
      '@typescript-eslint': typescript,
      'unused-imports': unusedImports,
      intent: intentPlugin,
    },
    rules: {
      ...svelte.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
      'unused-imports/no-unused-imports': 'error',
      'max-lines': ['error', { max: 1200 }],
    },
  },
  {
    files: ['src/**/*.{js,mjs,ts,tsx,svelte}'],
    ignores: productionModuleIgnores,
    plugins: {
      intent: intentPlugin,
    },
    rules: {
      'intent/no-adhoc-transitions': 'error',
      'intent/no-arbitrary-motion-or-color': [
        'error',
        { allowlist: namedColorAllowlist, baseline: semanticColorBaseline },
      ],
      'intent/no-button-compatibility-aliases': 'error',
      'intent/icon-only-button-size': ['error', { baseline: iconOnlyButtonSizeBaseline }],
      'intent/no-dialog-root-outside-patterns': 'error',
      'intent/no-direct-toast': 'error',
      'intent/no-legacy-spinner': 'error',
      'intent/no-native-dialogs': 'error',
      'intent/no-raw-controls': 'error',
      'intent/no-raw-menu-row': 'error',
      'intent/no-raw-menu-surface': 'error',
      'intent/no-raw-inverse-surface': 'error',
      'intent/no-raw-typography': 'error',
      'intent/settings-use-schema': 'error',
    },
  },
  {
    files: ['src/**/*.{svelte,ts,tsx,js}'],
    ignores: productionModuleIgnores,
    plugins: { intent: intentPlugin },
    rules: { 'intent/no-uppercase': 'error' },
  },
  {
    files: ['src/**/*.css'],
    languageOptions: { parser: cssParser },
    plugins: { intent: intentPlugin },
    rules: { 'intent/no-uppercase': 'error' },
  },
  ...designSystemBaselineOverrides,
  {
    files: ['**/*.svelte'],
    ignores: componentAsyncDataFetchBaselineIgnorePatterns,
    plugins: {
      intent: intentPlugin,
    },
    rules: {
      'intent/no-component-async-data-fetch': 'error',
    },
  },
  // In-app navigation to `/workspace/<id>` never opens the workspace tab; each
  // caller that forgot the separate `openWorkspaceTab` dispatch shipped a jump
  // that switched pages without a tab (cloudlands-fe#3850, #3781, #3567).
  // `openAndShowWorkspace` is the only allowed workspace jump.
  {
    files: ['src/**/*.{js,ts,svelte}'],
    ignores: [...productionModuleIgnores, 'src/lib/utils/show-workspace.ts'],
    plugins: { intent: intentPlugin },
    rules: { 'intent/no-raw-workspace-navigation': 'error' },
  },
  // A keyboard handler that decides "is the user typing?" from tag names, contenteditable
  // or an input/textarea selector misses Monaco, which types through an EditContext
  // `<div role="textbox">`, so its shortcut fires while the user types in the code
  // editor (intent-hq/intent#8068 via cloudlands-fe#3848; intent-hq/intent#8115 via
  // cloudlands-fe#3865). isTextEntryTarget / isMultilineTextEntryTarget in
  // src/lib/utils/text-entry.ts are the one check. A non-typing use disables the rule on
  // its line with a reason, which intent/require-disable-reason checks. No baseline:
  // enforced at zero.
  {
    files: ['src/**/*.{js,ts,svelte}'],
    ignores: [...productionModuleIgnores, 'src/lib/utils/text-entry.ts'],
    plugins: { intent: intentPlugin },
    rules: {
      'intent/no-hand-written-typing-check': 'error',
      'intent/require-disable-reason': [
        'error',
        { rules: ['intent/no-hand-written-typing-check'] },
      ],
    },
  },
  // flushSync from an $effect cleanup, onDestroy callback, or action destroy()
  // flushes unrelated effects mid-teardown; any component mounted by that flush
  // throws effect_in_teardown (intent-hq/intent#4550, shipped in v2.141.0).
  // flushSync from an $effect / $effect.pre body nulls the batch still traversing
  // effects; the next effect that writes state throws `Cannot read properties of
  // null (reading 'schedule')` (sveltejs/svelte#18546; ErrorBoundary:MainLayout
  // crash in v2.161.3 via WorkspaceTabStrip and ResponseGroup).
  {
    files: ['**/*.svelte'],
    plugins: {
      intent: intentPlugin,
    },
    rules: {
      'intent/no-flushsync-in-teardown': 'error',
    },
  },
  // A direct `prefers-reduced-motion` query (matchMedia in script, `@media` in a
  // component <style>) sees only the OS preference and bypasses battery saver.
  // Reduced motion has one source of truth — `--motion-reduced` in tokens.css,
  // mirrored by `$lib/utils/reduced-motion` — so only those files may spell the
  // query. `.css`/`.html` files are covered by scripts/check-reduced-motion-queries.mjs.
  // Deliberately not `productionModuleIgnores`: generated files ship like any other
  // source, so only tests and the source of truth are exempt.
  {
    files: ['src/**/*.{js,mjs,cjs,jsx,ts,tsx,mts,cts,svelte}'],
    ignores: [...reducedMotionTestFileGlobs, ...reducedMotionSourceOfTruthFiles],
    plugins: {
      intent: intentPlugin,
    },
    rules: {
      'intent/no-direct-reduced-motion-query': 'error',
    },
  },
  // A catalog renderer, fixture or preview that builds a timestamp from the real clock
  // renders differently depending on when, and how slowly, it runs: the toast catalog's
  // "18s" attention toast snapshot read "20s" on a busy machine (2026-10-23). Time comes
  // from $lib/component-catalog/catalog-clock, the one exempt file. No baseline: zero debt.
  {
    files: [...catalogPreviewFileGlobs],
    ignores: [...catalogClockExemptGlobs],
    plugins: {
      intent: intentPlugin,
    },
    rules: {
      'intent/no-wall-clock-in-catalog-previews': 'error',
    },
  },
  ...themisFullConfig,
  {
    files: themisSourceFiles,
    ignores: productionModuleIgnores,
    rules: themisArchitectureRules,
  },
  {
    files: ['src/**/*.svelte'],
    ignores: productionModuleIgnores,
    rules: {
      'themis/forbidden-component-import': 'error',
    },
  },
  {
    files: themisSourceFiles,
    ignores: themisSelectorRuleIgnores,
    rules: themisSourceSelectorRules,
  },
  {
    files: themisSourceFiles,
    ignores: [...themisSelectorFiles, ...themisSelectorRuleIgnores],
    rules: {
      'themis/selector-file-name': 'error',
    },
  },
  {
    files: themisSelectorFiles,
    ignores: themisSelectorRuleIgnores,
    rules: {
      'themis/selector-export-name': 'error',
    },
  },
  {
    files: themisSelectorRuleIgnores,
    rules: themisTestSelectorRuleOverrides,
  },
  {
    files: themisSelectorRuleIgnores,
    rules: themisTestArchitectureRuleOverrides,
  },
  {
    files: themisTestFiles,
    rules: {
      'themis/test-selector-select': 'error',
    },
  },
  // Test files: allow non-null assertions. `!` on known fixtures/mocks is an
  // accepted test idiom; production code still warns via the base TS rules.
  {
    files: ['**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}', '**/__tests__/**', 'tests/**'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
];
