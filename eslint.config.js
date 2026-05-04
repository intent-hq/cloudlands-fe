import js from '@eslint/js';
import typescript from '@typescript-eslint/eslint-plugin';
import typescriptParser from '@typescript-eslint/parser';
import svelte from 'eslint-plugin-svelte';
import svelteParser from 'svelte-eslint-parser';
import unusedImports from 'eslint-plugin-unused-imports';
import noProductionDynamicImportRule from './eslint-rules/no-production-dynamic-import.js';
import selectorLifecycleRule from './eslint-rules/selector-lifecycle.js';

const intentPlugin = {
  rules: {
    'no-production-dynamic-import': noProductionDynamicImportRule,
    'selector-lifecycle': selectorLifecycleRule,
  },
};

// Staged rollout: enforce the dynamic-import ban only on files that have already
// been cleaned up. Existing repo-wide violations are intentionally baselined by
// omission until each file is migrated and added here.
const dynamicImportEnforcedFiles = [
  'src/features/accept-changes/main/accept-changes.service.ts',
  'src/features/agent/agent-ipc-bridge.ts',
  'src/features/agent/main/agent-backend-handler.service.ts',
  'src/features/mcp/main/mcp/ws-git-api.ts',
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
  'src/preload/generated-channels.ts',
];

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
      '**/parallel-runner/node_modules/**',
      '**/test-reports/**',
      '**/logs/**',
      '**/*.log',
      '**/src/preload/generated-channels.ts',
      '**/src/shared/generated/**',
      '**/.backup-state-migration/**',
      '**/.test-data/**',
      '**/*.cjs',
      '**/parallel-runner/**',
      '**/cdp_scripts/**',
      '**/cdp-mcp-server/**',
      '**/playwright/.cache/**',
      '**/playwright-report/**',
      '**/scripts/**',
      '**/e2e/**',
      '**/test/**',
      '**/examples/**',
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
      'intent/selector-lifecycle': 'warn',
      'max-lines': ['error', { max: 1200 }],
    },
  },
];
