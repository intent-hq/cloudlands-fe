import { builtinModules } from 'node:module';
import js from '@eslint/js';
import typescript from '@typescript-eslint/eslint-plugin';
import typescriptParser from '@typescript-eslint/parser';
import svelte from 'eslint-plugin-svelte';
import svelteParser from 'svelte-eslint-parser';
import unusedImports from 'eslint-plugin-unused-imports';
import noProductionDynamicImportRule from './eslint-rules/no-production-dynamic-import.js';
import noComponentAsyncDataFetchRule from './eslint-rules/no-component-async-data-fetch.js';

const intentPlugin = {
  rules: {
    'no-component-async-data-fetch': noComponentAsyncDataFetchRule,
    'no-production-dynamic-import': noProductionDynamicImportRule,
  },
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
  'src/features/onboarding/steps/WorkspaceCreationError.svelte',
  'src/features/workspace/SpacesSwitcherOverlay.svelte',
  'src/lib/components/AuggieSetupGate.svelte',
  'src/lib/components/CommandPalette.svelte',
  'src/lib/components/ErrorDisplay.svelte',
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
  'src/lib/components/chat/StreamingAnimatedContent.svelte',
  'src/lib/components/chat/StreamingMessageContent.svelte',
  'src/lib/components/chat/input/ContextPickerButton.svelte',
  'src/lib/components/chat/input/EnhancedMentionList.svelte',
  'src/lib/components/chat/input/ModelPicker.svelte',
  'src/lib/components/chat/input/SimpleRichInput.svelte',
  'src/lib/components/chat/input/TipTapEditor.svelte',
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
  'src/lib/components/file-tracking/CodeChangesPanel.svelte',
  'src/lib/components/file-tracking/FileChangesList.svelte',
  'src/lib/components/file-tracking/accept-changes/AcceptChangesPanel.svelte',
  'src/lib/components/file-tracking/accept-changes/ChangeTimeline.svelte',
  'src/lib/components/layout/WindowTitleBar.svelte',
  'src/lib/components/layout/panel-system/PanelLayout.svelte',
  'src/lib/components/layout/panel-system/PanelLayoutControls.svelte',
  'src/lib/components/layout/panel-system/PanelLayoutHeader.svelte',
  'src/lib/components/layout/panel-system/PanelTabBar.svelte',
  'src/lib/components/layout/sidebar-nav/SidebarNav.svelte',
  'src/lib/components/layout/sidebar-nav/cards/ActiveWorkspacesCard.svelte',
  'src/lib/components/layout/sidebar-nav/cards/AllWorkspacesCard.svelte',
  'src/lib/components/layout/sidebar-nav/cards/NewWorkspaceCard.svelte',
  'src/lib/components/markdown/MarkdownViewer.svelte',
  'src/lib/components/markdown/MermaidRenderer.svelte',
  'src/lib/components/modals/FeatureCodeDialog.svelte',
  'src/lib/components/modals/PullConflictDialog.svelte',
  'src/lib/components/notes/NotesPanel.svelte',
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
  'src/lib/components/shared/AgentAttributionBadge.svelte',
  'src/lib/components/terminal/QuakeTerminalOverlay.svelte',
  'src/lib/components/terminal/ScriptOutputViewer.svelte',
  'src/lib/components/terminal/SetupScriptBanner.svelte',
  'src/lib/components/terminal/Terminal.svelte',
  'src/lib/components/terminal/TerminalSidebar.svelte',
  'src/lib/components/tiptap/BubbleMenu.svelte',
  'src/lib/components/tiptap/CommentsSidebar.svelte',
  'src/lib/components/tiptap/ContextMentionNodeView.svelte',
  'src/lib/components/tiptap/LineAttributionGutter.svelte',
  'src/lib/components/tiptap/TaskAgentStatus.svelte',
  'src/lib/components/tiptap/TaskItemNodeView.svelte',
  'src/lib/components/tiptap/TaskMenu.svelte',
  'src/lib/components/tiptap/comments/UnifiedCommentThreadDemo.svelte',
  'src/lib/components/ui/CopyButton.svelte',
  'src/lib/components/ui/FileActionsDropdown.svelte',
  'src/lib/components/ui/OpenComboButton.svelte',
  'src/lib/components/ui/VirtualList.svelte',
  'src/lib/components/ui/WorkspaceActionsMenu.svelte',
  'src/lib/components/ui/diff/TrackedChangeDiffViewer.svelte',
  'src/lib/components/ui/list/ListExample.svelte',
  'src/lib/components/ui/searchable-combobox/searchable-combobox.svelte',
  'src/lib/components/ui/searchable-select/searchable-select.svelte',
  'src/lib/components/visualization/repo-visualizer/RepoVisualizer.svelte',
  'src/lib/components/visualization/repo-visualizer/TreeCanvas.svelte',
  'src/lib/components/workspace/CommentSystemDemo.svelte',
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
  'src/lib/components/workspace/initializer/RemoteSetupSelector.svelte',
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
  'src/routes/+layout.svelte',
  'src/routes/agent/[id]/+page.svelte',
  'src/routes/observability/+page.svelte',
  'src/routes/settings/+page.svelte',
  'src/routes/test-comments/+page.svelte',
  'src/routes/test-error-boundary/+page.svelte',
  'src/routes/test-input/+page.svelte',
  'src/routes/test-mentions/+page.svelte',
  'src/routes/test-mentions/compact-initializer-test.svelte',
  'src/routes/test-mentions/compact/+page.svelte',
  'src/routes/workspace/[id]/+page.svelte',
];

const componentAsyncDataFetchBaselineIgnorePatterns = componentAsyncDataFetchBaselineFiles.map((file) =>
  file.replaceAll('[', '\\[').replaceAll(']', '\\]'),
);

// Browser safety: renderer code (src/lib, src/routes, src/store, feature roots)
// must never import Electron, Node builtins, or main-process (`**/main/**`)
// subtrees — it has to stay runnable in a plain browser context. Type-only
// imports are allowed because they are erased at compile time. See
// docs/MODULE_BOUNDARY_GUIDE.md.
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

// Shared options for the renderer browser-safety no-restricted-imports rule;
// applied at `error` to clean files and `warn` to the baselined files below so
// new violations in baselined files stay visible while migration proceeds.
const rendererBrowserSafetyRestrictedImportsOptions = {
  paths: [
    {
      name: 'electron',
      message: 'Renderer code must stay browser-safe: Electron is only available in the main process. Route through IPC/preload instead (docs/MODULE_BOUNDARY_GUIDE.md).',
      allowTypeImports: true,
    },
  ],
  patterns: [
    {
      regex: '^electron/',
      message: 'Renderer code must stay browser-safe: Electron is only available in the main process. Route through IPC/preload instead (docs/MODULE_BOUNDARY_GUIDE.md).',
      allowTypeImports: true,
    },
    {
      regex: `^(node:)?(${nodeBuiltinModules.join('|')})(/|$)`,
      message: 'Renderer code must stay browser-safe: Node builtins are not available in the browser. Move the logic to the main process or use a browser-safe alternative (docs/MODULE_BOUNDARY_GUIDE.md).',
      allowTypeImports: true,
    },
    {
      regex: '(^|/)main(/|$)',
      message: 'Renderer code must never import from a main/ subtree. Extract a shared/browser-safe module or route through IPC instead (docs/MODULE_BOUNDARY_GUIDE.md).',
      allowTypeImports: true,
    },
  ],
};

export default [
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
      '**/.backup-state-migration/**',
      '**/.test-data/**',
      '**/*.cjs',
      '**/cdp-mcp-server/**',
      '**/playwright/.cache/**',
      '**/playwright-report/**',
      '**/scripts/**',
      '**/e2e/**',
      '**/test/**',
    ],
  },
  {
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
      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
      }],
      'unused-imports/no-unused-imports': 'error',
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
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
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
      }],
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
  // Ban synchronous child_process calls in Electron main process code.
  // execSync/spawnSync block the main thread and can freeze the entire UI
  // if the spawned process hangs (see: hang report 2026-02-28).
  // Use execAsync (promisified exec) or spawn instead.
  {
    files: [
      'src/main/**/*.ts',
      'src/features/*/main/**/*.ts',
      'src/shared/main/**/*.ts',
      'src/shared/git/**/*.ts',
    ],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [{
          name: 'child_process',
          importNames: ['execSync', 'spawnSync', 'execFileSync'],
          message: 'Synchronous child_process calls block the Electron main thread. Use exec/spawn with util.promisify or the execAsync helper instead.',
        }],
      }],
    },
  },
  // Browser safety for renderer code: no Electron, no Node builtins, no
  // main-process subtrees. See docs/MODULE_BOUNDARY_GUIDE.md and the
  // rendererBrowserSafetyBaselineFiles comment above.
  {
    files: [
      'src/lib/**/*.{js,mjs,ts,tsx,svelte}',
      'src/routes/**/*.{js,mjs,ts,tsx,svelte}',
      'src/store/**/*.{js,mjs,ts,tsx,svelte}',
      'src/features/**/*.{js,mjs,ts,tsx,svelte}',
    ],
    ignores: [
      'src/**/main/**',
      ...productionModuleIgnores,
      ...rendererBrowserSafetyBaselineFiles,
    ],
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
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
      }],
      'unused-imports/no-unused-imports': 'error',
      'max-lines': ['error', { max: 1200 }],
    },
  },
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
  // Test files: allow non-null assertions. `!` on known fixtures/mocks is an
  // accepted test idiom; production code still warns via the base TS rules.
  {
    files: [
      '**/*.test.{ts,tsx}',
      '**/*.spec.{ts,tsx}',
      '**/__tests__/**',
      'tests/**',
    ],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
];
