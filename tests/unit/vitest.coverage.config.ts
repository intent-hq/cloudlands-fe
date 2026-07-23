/**
 * Vitest Coverage Configuration for Unit Tests
 *
 * Configures code coverage reporting for the Agent System services
 */

import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    coverage: {
      enabled: true,
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage',

      // Include only the services we're testing
      include: [
        'src/features/agent/services/unified-id-service.ts',
        'src/features/agent/services/stream-manager.ts',
        'src/features/agent/services/unified-state-store.ts',
        'src/features/agent/services/cached-rules-service.ts',
        'src/features/agent/services/performance-optimizer.ts',
      ],

      // Exclude test files and mocks
      exclude: [
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/__tests__/**',
        '**/__mocks__/**',
        '**/node_modules/**',
        '**/dist/**',
        '**/build/**',
      ],

      // Coverage thresholds
      thresholds: {
        statements: 90,
        branches: 85,
        functions: 90,
        lines: 90,
      },

      // Report uncovered lines
      all: true,
      clean: true,
      skipFull: false,
    },
  },

  resolve: {
    alias: {
      '@': path.resolve(__dirname, '../../src'),
      $lib: path.resolve(__dirname, '../../src/lib'),
      $features: path.resolve(__dirname, '../../src/features'),
      $shared: path.resolve(__dirname, '../../src/shared'),
    },
  },
});
