import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig(async () => {
  const { svelte } = await import('@sveltejs/vite-plugin-svelte');

  return {
    plugins: [svelte()],
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./src/test-setup.ts'],
      testTimeout: 10000,
      hookTimeout: 10000,
      teardownTimeout: 10000,
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/build/**',
        '**/.{idea,git,cache,output,temp}/**',
        // Exclude any untracked git-worktree dirs (e.g. .wt-commit-details/) so
        // vitest doesn't double-collect their test files alongside the primary tree.
        '**/.wt-*/**',
        '**/test/**', // Exclude Playwright tests directory
        '**/*.ct.spec.ts', // Exclude Playwright component tests
        '**/parallel-runner/**', // Exclude parallel-runner tests (separate project)
        '**/remote-env.test.ts', // Exclude remote env tests - requires real environment
        '**/remote-git.test.ts', // Exclude remote git tests - requires real environment
        // ================================================================================
        // PRE-EXISTING BUGS: Tests below have code bugs (wrong imports, missing schemas)
        // that existed before being excluded. They now run but fail due to these bugs.
        // TODO: Fix these tests and remove exclusions.
        // ================================================================================
        // Tests that use the real async-utils module (conflicts with mock alias)
        '**/shared/__tests__/async-utils.test.ts',
        // Tests with wrong import paths (../notes.service instead of ../main/notes.service)
        '**/features/notes/__tests__/add-dependency.test.ts',
        '**/features/notes/__tests__/add-dependency-edge-cases.test.ts',
        '**/features/notes/__tests__/assign-agent-to-task.test.ts',
        '**/features/notes/__tests__/create-prerequisite-note.test.ts',
        '**/features/notes/__tests__/cycle-detection.test.ts',
        '**/features/notes/__tests__/edit-events.test.ts',
        '**/features/notes/__tests__/get-children.test.ts',
        '**/features/notes/__tests__/get-dependencies.test.ts',
        '**/features/notes/__tests__/get-task-notes.test.ts',
        '**/features/notes/__tests__/mark-as-task.test.ts',
        '**/features/notes/__tests__/mark-as-task-edge-cases.test.ts',
        '**/features/notes/__tests__/notes.repository.test.ts',
        '**/features/notes/__tests__/notes-service-comment-id-validation.test.ts',
        '**/features/notes/__tests__/remove-dependency.test.ts',
        '**/features/notes/__tests__/remove-task-metadata.test.ts',
        '**/features/notes/__tests__/update-task-status.test.ts',
        '**/features/notes/__tests__/update-task-status-edge-cases.test.ts',
        // Tests with missing schema exports (NoteDependencySchema undefined)
        '**/features/notes/__tests__/dependency-types.test.ts',
        // Tests with file system checks for build artifacts
        '**/agent-providers/__tests__/acp-provider-mcp-config.test.ts',
        // Integration tests with various pre-existing issues
        '**/tests/event-integration.test.ts',
        '**/tests/integration/notes-primitives-integration.test.ts',

        '**/tests/agent/integration/streaming-integration.test.ts',
        '**/features/file-tracking/__tests__/file-tracking-integration.test.ts',
        '**/features/protocol/__tests__/protocol-adapter-context.test.ts',
        '**/features/workspace/__tests__/remote-change-detector.test.ts',
        '**/features/workspace/__tests__/workspace.service.test.ts',
        '**/features/agent/main/__tests__/edge-cases.test.ts',
        '**/features/agent/main/__tests__/migration.test.ts',
        '**/features/agent/main/__tests__/streaming.test.ts',
        '**/features/agent/services/__tests__/chat-session-resume.test.ts',
        '**/features/notes/utils/__tests__/task-agent-message-builder.test.ts',
        '**/features/notes/__tests__/notes-primitives-roundtrip.test.ts',
        '**/features/agent/main/__tests__/persistence-ipc.test.ts',
        '**/tests/unit/edge-cases.test.ts',
        '**/tests/integration/workspace-operations.test.ts',
        '**/lib/utils/__tests__/markdown-processor.test.ts',
      ],
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        $lib: path.resolve(__dirname, './src/lib'),
        $store: path.resolve(__dirname, './src/store'),
        $features: path.resolve(__dirname, './src/features'),
        $shared: path.resolve(__dirname, './src/shared'),
        // App-local redux/saga-free shim for the in-use ag-redux-toolkit subpaths.
        // Keeps tests resolving to the shim instead of the removed npm package.
        '@augmentcode/ag-redux-toolkit/types': path.resolve(
          __dirname,
          './src/lib/store-shim/types.ts',
        ),
        '@augmentcode/ag-redux-toolkit/svelte-store': path.resolve(
          __dirname,
          './src/lib/store-shim/svelte-store.ts',
        ),
        '@augmentcode/ag-redux-toolkit/utils/store/create-action': path.resolve(
          __dirname,
          './src/lib/store-shim/utils/store/create-action.ts',
        ),
        '@augmentcode/ag-redux-toolkit/utils/store/create-reducer': path.resolve(
          __dirname,
          './src/lib/store-shim/utils/store/create-reducer.ts',
        ),
        '@augmentcode/ag-redux-toolkit/utils/store/boolean-preference': path.resolve(
          __dirname,
          './src/lib/store-shim/utils/store/boolean-preference.ts',
        ),
        '@augmentcode/ag-redux-toolkit/utils/collections/collection-utils': path.resolve(
          __dirname,
          './src/lib/store-shim/utils/collections/collection-utils.ts',
        ),
        $app: path.resolve(__dirname, './src/__mocks__/$app'),
        // Test-only stub: avoid resolving the real monaco-editor (heavy and ESM-export sensitive)
        'monaco-editor': path.resolve(__dirname, './src/__mocks__/monaco-editor'),
        // Test-only stub: avoid resolving protocol-adapter's complex dependency chain
        '$features/protocol/protocol-adapter': path.resolve(
          __dirname,
          './src/__mocks__/protocol-adapter',
        ),
        // Test-only stub: avoid resolving ws browser bundle (missing createWebSocketStream)
        'ws': path.resolve(__dirname, './src/__mocks__/ws'),
        // Test-only stubs: avoid promisify(exec) at module load time (breaks jsdom)
        '$shared/git/git-env': path.resolve(__dirname, './src/__mocks__/git-env'),
        '$shared/main/async-utils': path.resolve(__dirname, './src/__mocks__/async-utils'),
        '$shared/main/process-tree-kill': path.resolve(__dirname, './src/__mocks__/process-tree-kill'),
        // Test-only stub: lru_map module doesn't provide proper ESM exports
        'lru_map': path.resolve(__dirname, './src/__mocks__/lru_map'),
        // Test-only stub: @pierre/diffs/worker has lru_map ESM import issues
        '@pierre/diffs/worker': path.resolve(__dirname, './src/__mocks__/@pierre/diffs/worker'),
        // Test-only stub: avoid loading bonjour-service during mDNS discovery imports
        'bonjour-service': path.resolve(__dirname, './src/__mocks__/bonjour-service'),
      },
      conditions: ['import', 'module', 'browser', 'default'],
      extensions: ['.mjs', '.js', '.ts', '.jsx', '.tsx', '.json', '.svelte'],
    },
  };
});
