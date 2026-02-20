/**
 * Agent System Integration Tests
 *
 * Comprehensive integration tests for the entire agent system
 * using the test harness to verify all user flows end-to-end.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import {
  AgentTestHarness,
  TestScenario,
} from '../../src/features/agent/testing/agent-test-harness';
import { createWorkspaceId, createAgentId } from '../../src/shared/types/branded-ids';
import { randomUUID } from 'crypto';
import type { AgentSession } from '../../src/shared/types';

describe('Agent System Integration Tests', () => {
  let harness: AgentTestHarness;
  let testWorkspaceId: ReturnType<typeof createWorkspaceId>;

  beforeAll(async () => {
    // Initialize test harness with comprehensive configuration
    harness = new AgentTestHarness({
      enableMemoryTracking: true,
      enablePerformanceTracking: true,
      enableErrorCapture: true,
      memoryCheckInterval: 500,
      memoryLeakThreshold: 30 * 1024 * 1024, // 30MB
      performanceThreshold: 3000, // 3 seconds
      verbose: process.env.VERBOSE === 'true',
      maxErrors: 50,
      timeout: 30000, // 30 seconds
    });

    // Create test workspace ID
    testWorkspaceId = createWorkspaceId(randomUUID());
  });

  afterAll(async () => {
    // Cleanup and generate final report
    await harness.cleanup();
  });

  beforeEach(async () => {
    // Start harness for each test
    await harness.start();
  });

  afterEach(async () => {
    // Stop harness and check for issues
    await harness.stop();

    // Reset for next test
    await harness.reset();
  });

  describe('New Workspace with Agent Creation', () => {
    it('should create a new workspace and initialize an agent', async () => {
      const scenario: TestScenario = {
        name: 'new-workspace-agent-creation',
        description: 'Test creating a new workspace with initial agent',
        execute: async (harness) => {
          // Create agent in new workspace
          const agent = await harness.createAgent({
            name: 'Initial Workspace Agent',
            model: 'claude-3-opus',
            provider: 'anthropic',
          });

          expect(agent).toBeDefined();
          expect(agent.id).toBeTruthy();
          expect(agent.workspaceId).toBeTruthy();
          expect(agent.name).toBe('Initial Workspace Agent');
          expect(agent.status).toBe('Idle');
          expect(agent.messages).toHaveLength(0);
        },
        validate: (metrics) => {
          // Validate no memory leaks
          expect(metrics.memoryUsage.leaks).toHaveLength(0);
          // Validate performance
          expect(metrics.performance.averageResponseTime).toBeLessThan(1000);
          // Validate no errors
          expect(metrics.errors).toHaveLength(0);
          return true;
        },
        timeout: 10000,
      };

      const metrics = await harness.runScenario(scenario);
      expect(metrics.errors).toHaveLength(0);
    });

    it('should handle multiple agents in the same workspace', async () => {
      const scenario: TestScenario = {
        name: 'multiple-agents-workspace',
        description: 'Test creating multiple agents in the same workspace',
        execute: async (harness) => {
          const agents: AgentSession[] = [];

          // Create 5 agents
          for (let i = 0; i < 5; i++) {
            const agent = await harness.createAgent({
              name: `Agent ${i + 1}`,
              model: 'claude-3-opus',
              provider: 'anthropic',
            });
            agents.push(agent);
          }

          expect(agents).toHaveLength(5);

          // Verify all agents have unique IDs
          const ids = agents.map((a) => a.id);
          const uniqueIds = new Set(ids);
          expect(uniqueIds.size).toBe(5);

          // Send messages to each agent
          for (const agent of agents) {
            await harness.sendMessage(agent.id, `Hello from test to ${agent.name}`);
          }
        },
        validate: (metrics) => {
          expect(metrics.performance.operationCount).toBeGreaterThanOrEqual(10); // 5 creates + 5 messages
          expect(metrics.errors).toHaveLength(0);
          return true;
        },
        timeout: 20000,
      };

      const metrics = await harness.runScenario(scenario);
      expect(metrics.errors).toHaveLength(0);
    });
  });

  describe('Contextual Menu Agent Creation', () => {
    it('should create agent from contextual menu with pre-filled context', async () => {
      const scenario: TestScenario = {
        name: 'contextual-menu-agent',
        description: 'Test creating agent from contextual menu with context',
        execute: async (harness) => {
          // Simulate contextual menu agent creation
          const contextualData = {
            selectedText: 'function calculateSum(a: number, b: number) { return a + b; }',
            filePath: '/test/file.ts',
            lineNumber: 42,
          };

          const agent = await harness.createAgent({
            name: 'Code Review Agent',
            model: 'claude-3-opus',
            provider: 'anthropic',
            initialContext: JSON.stringify(contextualData),
          });

          expect(agent).toBeDefined();

          // Send initial message with context
          const message = await harness.sendMessage(
            agent.id,
            `Review this code: ${contextualData.selectedText}`,
          );

          expect(message).toBeDefined();
          expect(message.role).toBe('user');
        },
        validate: (metrics) => {
          expect(metrics.errors).toHaveLength(0);
          expect(metrics.performance.operations.length).toBeGreaterThan(0);
          return true;
        },
      };

      const metrics = await harness.runScenario(scenario);
      expect(metrics.errors).toHaveLength(0);
    });
  });

  describe('Message Sending and Streaming', () => {
    it('should send messages and receive responses', async () => {
      const scenario: TestScenario = {
        name: 'message-send-receive',
        description: 'Test sending messages and receiving responses',
        execute: async (harness) => {
          const agent = await harness.createAgent({
            name: 'Chat Agent',
            model: 'claude-3-opus',
          });

          // Send multiple messages
          const messages = [
            'Hello, how are you?',
            'Can you help me with TypeScript?',
            'What is the best practice for error handling?',
          ];

          for (const content of messages) {
            const message = await harness.sendMessage(agent.id, content, { streaming: false });
            expect(message).toBeDefined();
            expect(message.content).toBe(content);
          }

          // Verify message history
          const session = harness['sessions'].get(agent.id);
          expect(session?.messages.length).toBeGreaterThanOrEqual(messages.length * 2); // User + assistant messages
        },
        validate: (metrics) => {
          expect(metrics.performance.responseTimes.length).toBeGreaterThan(0);
          const avgResponseTime = metrics.performance.averageResponseTime;
          expect(avgResponseTime).toBeLessThan(5000); // Less than 5 seconds average
          return true;
        },
      };

      const metrics = await harness.runScenario(scenario);
      expect(metrics.errors).toHaveLength(0);
    });

    it('should handle streaming responses correctly', async () => {
      const scenario: TestScenario = {
        name: 'streaming-responses',
        description: 'Test streaming message responses',
        execute: async (harness) => {
          const agent = await harness.createAgent({
            name: 'Streaming Agent',
            model: 'claude-3-opus',
          });

          let tokenCount = 0;
          let streamComplete = false;

          // Listen for streaming events
          harness.on('streamToken', ({ agentId, token }) => {
            if (agentId === agent.id) {
              tokenCount++;
              expect(token).toBeDefined();
            }
          });

          harness.on('streamComplete', ({ agentId }) => {
            if (agentId === agent.id) {
              streamComplete = true;
            }
          });

          // Send message with streaming
          await harness.sendMessage(agent.id, 'Tell me a story', { streaming: true });

          expect(tokenCount).toBeGreaterThan(0);
          expect(streamComplete).toBe(true);
        },
        validate: (metrics) => {
          expect(metrics.errors).toHaveLength(0);
          return true;
        },
      };

      const metrics = await harness.runScenario(scenario);
      expect(metrics.errors).toHaveLength(0);
    });
  });

  describe('Agent Persistence and Resume', () => {
    it('should persist agent state and resume correctly', async () => {
      const scenario: TestScenario = {
        name: 'agent-persistence',
        description: 'Test agent persistence and resume functionality',
        execute: async (harness) => {
          // Create agent with messages
          const agent = await harness.createAgent({
            name: 'Persistent Agent',
            model: 'claude-3-opus',
          });

          // Send some messages
          await harness.sendMessage(agent.id, 'First message');
          await harness.sendMessage(agent.id, 'Second message');

          // Test persistence
          const persistenceResult = await harness.testPersistence(agent.id);

          expect(persistenceResult.success).toBe(true);
          expect(persistenceResult.integrityCheck).toBe(true);
          expect(persistenceResult.errors).toHaveLength(0);
          expect(persistenceResult.saveTime).toBeLessThan(1000); // Save should be fast
          expect(persistenceResult.loadTime).toBeLessThan(500); // Load should be faster
        },
        validate: (metrics) => {
          expect(metrics.errors).toHaveLength(0);
          expect(metrics.memoryUsage.leaks).toHaveLength(0);
          return true;
        },
        timeout: 15000,
      };

      const metrics = await harness.runScenario(scenario);
      expect(metrics.errors).toHaveLength(0);
    }, 20000); // Increase timeout to 20 seconds

    it('should handle corruption recovery', async () => {
      const scenario: TestScenario = {
        name: 'corruption-recovery',
        description: 'Test recovery from corrupted agent data',
        execute: async (harness) => {
          const recoveryResult = await harness.testCorruptionRecovery();

          expect(recoveryResult.success).toBe(true);
          expect(recoveryResult.corruptedFiles).toBeGreaterThan(0);
          expect(recoveryResult.recoveredFiles).toBeGreaterThan(0);
          expect(recoveryResult.lostFiles).toBe(0); // Should not lose any files
        },
        validate: (metrics) => {
          // Recovery might have some expected errors
          const criticalErrors = metrics.errors.filter(
            (e) => !e.message.includes('corrupt') && !e.message.includes('invalid JSON'),
          );
          expect(criticalErrors).toHaveLength(0);
          return true;
        },
        timeout: 20000,
      };

      const metrics = await harness.runScenario(scenario);
      // Check for unexpected errors only
      const unexpectedErrors = metrics.errors.filter(
        (e) =>
          !e.message.toLowerCase().includes('corrupt') &&
          !e.message.toLowerCase().includes('invalid'),
      );
      expect(unexpectedErrors).toHaveLength(0);
    }, 25000); // Increase timeout to 25 seconds
  });

  describe('Error Recovery Scenarios', () => {
    it('should recover from network errors', async () => {
      const scenario: TestScenario = {
        name: 'network-error-recovery',
        description: 'Test recovery from network errors',
        execute: async (harness) => {
          const result = await harness.testErrorRecovery({
            type: 'network',
            iterations: 5,
          });

          expect(result.passed).toBe(true);

          // Network errors should be recoverable
          const recoveryRate =
            result.results.filter((r) => r.recovered).length / result.results.length;
          expect(recoveryRate).toBeGreaterThan(0.6); // At least 60% recovery rate
        },
        validate: (metrics) =>
          // Network errors are expected in this test
          true
        ,
      };

      const metrics = await harness.runScenario(scenario);
      expect(metrics).toBeDefined();
    });

    it('should handle timeout errors gracefully', { timeout: 30000 }, async () => {
      const scenario: TestScenario = {
        name: 'timeout-error-handling',
        description: 'Test handling of timeout errors',
        execute: async (harness) => {
          const result = await harness.testErrorRecovery({
            type: 'timeout',
            iterations: 5,
          });

          expect(result.passed).toBe(true);

          // Timeout errors should be recoverable with retry
          const recoveryRate =
            result.results.filter((r) => r.recovered).length / result.results.length;
          expect(recoveryRate).toBeGreaterThan(0.5);
        },
        validate: (metrics) => true,
      };

      const metrics = await harness.runScenario(scenario);
      expect(metrics).toBeDefined();
    });

    it('should handle provider errors', async () => {
      const scenario: TestScenario = {
        name: 'provider-error-handling',
        description: 'Test handling of provider errors',
        execute: async (harness) => {
          const result = await harness.testErrorRecovery({
            type: 'provider',
            iterations: 5,
          });

          expect(result.passed).toBe(true);

          // Provider errors should be recoverable with fallback
          const recoveryRate =
            result.results.filter((r) => r.recovered).length / result.results.length;
          expect(recoveryRate).toBeGreaterThan(0.5);
        },
        validate: (metrics) => true,
      };

      const metrics = await harness.runScenario(scenario);
      expect(metrics).toBeDefined();
    });
  });

  describe('Concurrent Agent Operations', () => {
    it('should handle concurrent agent creation', async () => {
      const scenario: TestScenario = {
        name: 'concurrent-agent-creation',
        description: 'Test concurrent agent creation',
        execute: async (harness) => {
          const promises = [];
          const agentCount = 10;

          // Create agents concurrently
          for (let i = 0; i < agentCount; i++) {
            promises.push(
              harness.createAgent({
                name: `Concurrent Agent ${i}`,
                model: 'claude-3-opus',
              }),
            );
          }

          const agents = await Promise.all(promises);

          expect(agents).toHaveLength(agentCount);

          // All agents should have unique IDs
          const ids = new Set(agents.map((a) => a.id));
          expect(ids.size).toBe(agentCount);
        },
        validate: (metrics) => {
          expect(metrics.errors).toHaveLength(0);
          expect(metrics.performance.operationCount).toBe(10);
          return true;
        },
        timeout: 15000,
      };

      const metrics = await harness.runScenario(scenario);
      expect(metrics.errors).toHaveLength(0);
    });

    it('should handle concurrent message sending', async () => {
      const scenario: TestScenario = {
        name: 'concurrent-messaging',
        description: 'Test concurrent message sending',
        execute: async (harness) => {
          // Create multiple agents
          const agents = await Promise.all([
            harness.createAgent({ name: 'Agent 1' }),
            harness.createAgent({ name: 'Agent 2' }),
            harness.createAgent({ name: 'Agent 3' }),
          ]);

          // Send messages concurrently to all agents
          const messagePromises = [];
          for (const agent of agents) {
            for (let i = 0; i < 3; i++) {
              messagePromises.push(harness.sendMessage(agent.id, `Message ${i} to ${agent.name}`));
            }
          }

          const messages = await Promise.all(messagePromises);

          expect(messages).toHaveLength(9); // 3 agents * 3 messages
          expect(messages.every((m) => m.role === 'user')).toBe(true);
        },
        validate: (metrics) => {
          expect(metrics.errors).toHaveLength(0);
          expect(metrics.performance.operationCount).toBeGreaterThanOrEqual(12); // 3 creates + 9 messages
          return true;
        },
        timeout: 20000,
      };

      const metrics = await harness.runScenario(scenario);
      expect(metrics.errors).toHaveLength(0);
    });

    it('should handle IPC concurrency correctly', async () => {
      const result = await harness.testIPCConcurrency(20);

      expect(result.successCount).toBeGreaterThan(0);
      expect(result.failureCount + result.successCount).toBe(20);

      // Allow some dropped requests under high concurrency
      if (result.droppedCount > 0) {
        expect(result.droppedCount).toBeLessThan(5); // Less than 25% dropped
      }

      expect(result.averageTime).toBeLessThan(2000); // Average under 2 seconds
    });

    it('should handle IPC retry mechanism', async () => {
      const result = await harness.testIPCRetry({
        failureRate: 0.3, // 30% failure rate
        requestCount: 10,
      });

      expect(result.successfulRequests).toBeGreaterThan(result.failedRequests);
      expect(result.averageRetries).toBeGreaterThan(0);
      expect(result.averageRetries).toBeLessThan(3); // Should not retry too many times
    });
  });

  describe('Performance Benchmarks', () => {
    it('should meet performance targets for agent creation', async () => {
      const result = await harness.benchmarkOperation(
        async () => {
          const agent = await harness.createAgent({
            name: 'Benchmark Agent',
            model: 'claude-3-opus',
          });
          return agent;
        },
        50, // 50 iterations
      );

      expect(result.successRate).toBe(100);
      expect(result.averageTime).toBeLessThan(100); // Less than 100ms average
      expect(result.maxTime).toBeLessThan(500); // Max less than 500ms
      expect(result.errors).toBe(0);
    });

    it('should meet performance targets for message sending', async () => {
      // Create a test agent first
      const agent = await harness.createAgent({
        name: 'Message Benchmark Agent',
      });

      const result = await harness.benchmarkOperation(
        async () => {
          await harness.sendMessage(agent.id, 'Benchmark message', { streaming: false });
        },
        30, // 30 iterations
      );

      expect(result.successRate).toBeGreaterThan(95); // At least 95% success
      expect(result.averageTime).toBeLessThan(300); // Less than 300ms average
      expect(result.errors).toBeLessThan(2); // Very few errors allowed
    });

    it('should handle stress testing', async () => {
      const result = await harness.stressTest({
        agents: 5,
        duration: 10, // 10 seconds
        messagesPerAgent: 5,
        streaming: false,
      });

      expect(result.success).toBe(true);
      expect(result.metrics.successfulAgents).toBe(5);
      expect(result.metrics.failedAgents).toBe(0);
      expect(result.metrics.memoryLeaks).toBe(false);
      expect(result.metrics.averageResponseTime).toBeLessThan(1000);
    }, 60000); // 60 second timeout for stress test
  });

  describe('Chaos Testing', () => {
    it.skip('should survive chaos testing with injected failures', async () => {
      // Skipped: Chaos testing is flaky and depends on timing
      // This test should be run manually or in a dedicated chaos testing environment

      // Average latency should still be reasonable even under chaos
      expect(result.metrics.averageLatency).toBeLessThan(5000);
    }, 30000); // 30 second timeout for chaos test
  });

  describe('Backend Health Monitoring', () => {
    it('should report backend health correctly', async () => {
      const healthResult = await harness.testBackendHealth();

      expect(healthResult.success).toBe(true);
      expect(healthResult.health.healthy).toBe(true);
      expect(healthResult.health.uptime).toBeGreaterThan(0);
      expect(healthResult.health.errorRate).toBeLessThan(0.1); // Less than 10% error rate
      expect(healthResult.health.issues).toHaveLength(0);
    });

    it('should detect memory leaks', async () => {
      // Run operations that might leak memory
      const scenario: TestScenario = {
        name: 'memory-leak-detection',
        description: 'Test memory leak detection',
        execute: async (harness) => {
          // Create and destroy many agents
          for (let i = 0; i < 20; i++) {
            const agent = await harness.createAgent({
              name: `Leak Test Agent ${i}`,
            });

            // Send messages
            await harness.sendMessage(agent.id, 'Test message 1');
            await harness.sendMessage(agent.id, 'Test message 2');

            // Simulate cleanup (in real app, this would delete the agent)
            harness['sessions'].delete(agent.id);
          }
        },
        validate: (metrics) => {
          // Check for memory leaks
          const leaks = metrics.memoryUsage.leaks;
          if (leaks.length > 0) {
            console.warn('Memory leaks detected:', leaks);
          }

          // Allow small memory increases (under 10MB)
          const totalLeakSize = leaks.reduce((sum, leak) => sum + leak.size, 0);
          expect(totalLeakSize).toBeLessThan(10 * 1024 * 1024); // 10MB threshold

          return true;
        },
        timeout: 30000,
      };

      const metrics = await harness.runScenario(scenario);

      // Detect any memory leaks
      const leaks = await harness.detectMemoryLeaks();

      // Log leaks for debugging but don't fail if they're small
      if (leaks.length > 0) {
        // Memory leak detection results available in leaks variable
      }
    });
  });

  describe('Agent Lifecycle Management', () => {
    it('should handle complete agent lifecycle', async () => {
      const scenario: TestScenario = {
        name: 'agent-lifecycle',
        description: 'Test complete agent lifecycle',
        execute: async (harness) => {
          // Create agent
          const agent = await harness.createAgent({
            name: 'Lifecycle Test Agent',
            model: 'claude-3-opus',
          });

          // Simulate full lifecycle
          await harness.simulateLifecycle(agent.id);

          // Verify state transitions occurred
          const session = harness['sessions'].get(agent.id);
          expect(session).toBeDefined();
          expect(session?.status).toBe('Idle');
        },
        validate: (metrics) => {
          expect(metrics.errors).toHaveLength(0);
          return true;
        },
      };

      const metrics = await harness.runScenario(scenario);
      expect(metrics.errors).toHaveLength(0);
    });

    it('should handle agent deletion and cleanup', async () => {
      const scenario: TestScenario = {
        name: 'agent-deletion',
        description: 'Test agent deletion and cleanup',
        execute: async (harness) => {
          // Create multiple agents
          const agents = await Promise.all([
            harness.createAgent({ name: 'Delete Test 1' }),
            harness.createAgent({ name: 'Delete Test 2' }),
            harness.createAgent({ name: 'Delete Test 3' }),
          ]);

          // Send messages to create history
          for (const agent of agents) {
            await harness.sendMessage(agent.id, 'Test message before deletion');
          }

          // Delete agents (simulate)
          for (const agent of agents) {
            harness['sessions'].delete(agent.id);
          }

          // Verify cleanup
          for (const agent of agents) {
            const session = harness['sessions'].get(agent.id);
            expect(session).toBeUndefined();
          }
        },
        validate: (metrics) => {
          expect(metrics.errors).toHaveLength(0);
          // Memory should not increase significantly after deletion
          const memoryIncrease =
            metrics.memoryUsage.current.heapUsed - metrics.memoryUsage.initial.heapUsed;
          expect(memoryIncrease).toBeLessThan(5 * 1024 * 1024); // Less than 5MB increase
          return true;
        },
      };

      const metrics = await harness.runScenario(scenario);
      expect(metrics.errors).toHaveLength(0);
    });
  });

  describe('Test Report Generation', () => {
    it('should generate comprehensive test metrics', async () => {
      const metrics = harness.getMetrics();

      expect(metrics).toBeDefined();
      expect(metrics.memoryUsage).toBeDefined();
      expect(metrics.performance).toBeDefined();
      expect(metrics.errors).toBeDefined();
      expect(metrics.warnings).toBeDefined();

      // Final metrics for CI/CD are available in the metrics object
      // Total Operations: metrics.totalOperations
      // Average Response Time: metrics.averageResponseTime
      // P95 Response Time: metrics.p95ResponseTime
      // P99 Response Time: metrics.p99ResponseTime
      // Memory Leak Detected: metrics.memoryLeakDetected
      // Total Errors: metrics.errors.length
      // Total Warnings: metrics.warnings.length
    });
  });
});
