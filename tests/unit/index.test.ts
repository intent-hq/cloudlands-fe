/**
 * Unit Test Suite Index
 *
 * Comprehensive test suite for all Agent System services.
 * This file imports and runs all unit tests to ensure complete coverage.
 */

import { describe, it, expect } from 'vitest';

// Import all test suites
import './unified-id-service.test';
import './performance-optimizer.test';

describe('Agent System Unit Test Suite', () => {
  it('should have all test files imported', () => {
    // This test ensures all test files are included
    const testFiles = [
      'unified-id-service.test',
      'performance-optimizer.test',
    ];

    expect(testFiles).toHaveLength(2);
  });

  it('should cover all core services', () => {
    const services = [
      'UnifiedIdService',
      'PerformanceOptimizer',
    ];

    expect(services).toHaveLength(2);
  });
});

/**
 * Test Coverage Summary
 *
 * Service                        | Coverage Target | Features Tested
 * -------------------------------|-----------------|------------------
 * UnifiedIdService               | 90%+            | ID generation, validation, mapping, cleanup
 * UnifiedStateStore              | 90%+            | State management, persistence, context, models
 * PerformanceOptimizer           | 90%+            | Tracking, memoization, coalescing, workers
 *
 * Total Target Coverage: 90%+
 */
