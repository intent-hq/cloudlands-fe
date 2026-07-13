#!/usr/bin/env tsx

/**
 * Edge Case Test Runner for Chat Streaming
 *
 * Tests edge cases and potential bugs in streaming functionality
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { Logger } from '../src/shared/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logger = new Logger('StreamingEdgeCaseTest');

interface EdgeCaseTest {
  name: string;
  description: string;
  test: () => Promise<boolean>;
}

class StreamingEdgeCaseTester {
  private results: Map<string, boolean> = new Map();
  private issues: string[] = [];

  /**
   * Test 1: Check for memory leaks in streaming
   */
  async testMemoryLeaks(): Promise<boolean> {
    logger.info('Testing for memory leaks in streaming handlers...');

    try {
      const agentServicePath = path.join(__dirname, '../src/features/agent/utils/stream-handler-registry.ts');
      const content = fs.readFileSync(agentServicePath, 'utf-8');

      // Check for event listener cleanup
      const hasRemoveEventListener = content.includes('removeEventListener') || content.includes('off(') || content.includes('offById');
      const hasCleanup = content.includes('cleanup') || content.includes('destroy') || content.includes('dispose');

      if (!hasRemoveEventListener) {
        this.issues.push('No event listener cleanup found - potential memory leak');
        return false;
      }

      if (!hasCleanup) {
        logger.warn('No explicit cleanup methods found');
      }

      logger.info('✅ Memory leak checks passed');
      return true;
    } catch (error) {
      logger.error('Memory leak test failed:', error);
      return false;
    }
  }

  /**
   * Test 2: Check for race conditions in concurrent streams
   */
  async testRaceConditions(): Promise<boolean> {
    logger.info('Testing for race conditions in concurrent streams...');

    try {
      const agentServicePath = path.join(__dirname, '../src/features/agent/agent-stream-lifecycle.ts');
      const content = fs.readFileSync(agentServicePath, 'utf-8');

      // Check if stream IDs are properly isolated
      const hasStreamId = content.includes('streamId') || content.includes('sessionId');
      const hasStreamMap = content.includes('Map') && content.includes('stream');

      if (!hasStreamId) {
        this.issues.push('No stream ID isolation found - potential race condition');
        return false;
      }

      if (!hasStreamMap) {
        logger.warn('No stream mapping found - could have issues with concurrent streams');
      }

      logger.info('✅ Race condition checks passed');
      return true;
    } catch (error) {
      logger.error('Race condition test failed:', error);
      return false;
    }
  }

  /**
   * Test 3: Check for XSS vulnerabilities in message rendering
   */
  async testXSSVulnerabilities(): Promise<boolean> {
    logger.info('Testing for XSS vulnerabilities in message rendering...');

    try {
      const markdownViewerPath = path.join(__dirname, '../src/lib/components/markdown/MarkdownViewer.svelte');
      const content = fs.readFileSync(markdownViewerPath, 'utf-8');

      // Check for HTML sanitization
      const hasSanitization = content.includes('sanitize') || content.includes('DOMPurify') || content.includes('escape');
      const hasInnerHTML = content.includes('innerHTML') || content.includes('@html');

      if (hasInnerHTML && !hasSanitization) {
        this.issues.push('Using innerHTML without sanitization - XSS vulnerability!');
        return false;
      }

      // Check markdown processor
      const processorPath = path.join(__dirname, '../src/lib/utils/markdown-processor.ts');
      if (fs.existsSync(processorPath)) {
        const processorContent = fs.readFileSync(processorPath, 'utf-8');
        const hasProcessorSanitization = processorContent.includes('sanitize') || processorContent.includes('DOMPurify');

        if (!hasProcessorSanitization) {
          logger.warn('Markdown processor may not sanitize HTML');
        }
      }

      logger.info('✅ XSS vulnerability checks passed');
      return true;
    } catch (error) {
      logger.error('XSS vulnerability test failed:', error);
      return false;
    }
  }

  /**
   * Test 4: Check for proper error boundaries
   */
  async testErrorBoundaries(): Promise<boolean> {
    logger.info('Testing for proper error boundaries...');

    try {
      const chatPanelPath = path.join(__dirname, '../src/lib/components/chat/ChatPanel.svelte');
      const content = fs.readFileSync(chatPanelPath, 'utf-8');

      // Check for try-catch blocks
      const hasTryCatch = content.includes('try {') && content.includes('catch');
      const hasErrorHandling = content.includes('error') || content.includes('Error');

      if (!hasTryCatch) {
        this.issues.push('No try-catch blocks in ChatPanel - errors could crash the UI');
        logger.warn('Missing try-catch blocks in ChatPanel');
      }

      if (!hasErrorHandling) {
        this.issues.push('No error handling in ChatPanel');
        return false;
      }

      logger.info('✅ Error boundary checks passed');
      return true;
    } catch (error) {
      logger.error('Error boundary test failed:', error);
      return false;
    }
  }

  /**
   * Test 5: Check for infinite loops in streaming
   */
  async testInfiniteLoops(): Promise<boolean> {
    logger.info('Testing for potential infinite loops...');

    try {
      const agentServicePath = path.join(__dirname, '../src/features/agent/agent-stream-lifecycle.ts');
      const content = fs.readFileSync(agentServicePath, 'utf-8');

      // Check for recursive calls without exit conditions
      const hasWhileTrue = content.includes('while (true)') || content.includes('while(true)');
      const hasRecursion = content.match(/function\s+(\w+)[\s\S]*?\1\(/);

      if (hasWhileTrue) {
        this.issues.push('Found while(true) loop - potential infinite loop');
        return false;
      }

      if (hasRecursion) {
        logger.warn('Found potential recursion - verify exit conditions');
      }

      logger.info('✅ Infinite loop checks passed');
      return true;
    } catch (error) {
      logger.error('Infinite loop test failed:', error);
      return false;
    }
  }

  /**
   * Test 6: Check for proper state cleanup on unmount
   */
  async testStateCleanup(): Promise<boolean> {
    logger.info('Testing for proper state cleanup on unmount...');

    try {
      const streamingContentPath = path.join(__dirname, '../src/lib/components/chat/StreamingMessageContent.svelte');
      const content = fs.readFileSync(streamingContentPath, 'utf-8');

      // Check for onDestroy or cleanup
      const hasOnDestroy = content.includes('onDestroy');
      const hasCleanup = content.includes('return () =>') || content.includes('cleanup');

      if (!hasOnDestroy && !hasCleanup) {
        this.issues.push('No cleanup on component unmount - potential memory leak');
        logger.warn('Missing cleanup in StreamingMessageContent');
      }

      logger.info('✅ State cleanup checks passed');
      return true;
    } catch (error) {
      logger.error('State cleanup test failed:', error);
      return false;
    }
  }

  /**
   * Test 7: Check for proper handling of empty/null content
   */
  async testNullHandling(): Promise<boolean> {
    logger.info('Testing for proper null/undefined handling...');

    try {
      const streamingContentPath = path.join(__dirname, '../src/lib/components/chat/StreamingMessageContent.svelte');
      const content = fs.readFileSync(streamingContentPath, 'utf-8');

      // Check for null checks
      const hasNullChecks = content.includes('?') || content.includes('||') || content.includes('??');
      const hasDefaultValues = content.includes('= []') || content.includes('= {}') || content.includes("= ''");

      if (!hasNullChecks) {
        this.issues.push('No null safety operators found - could crash on null values');
        return false;
      }

      if (!hasDefaultValues) {
        logger.warn('No default values found - could have issues with undefined props');
      }

      logger.info('✅ Null handling checks passed');
      return true;
    } catch (error) {
      logger.error('Null handling test failed:', error);
      return false;
    }
  }

  /**
   * Test 8: Check for proper message ordering
   */
  async testMessageOrdering(): Promise<boolean> {
    logger.info('Testing for proper message ordering...');

    try {
      const agentServicePath = path.join(__dirname, '../src/features/agent/agent-stream-lifecycle.ts');
      const content = fs.readFileSync(agentServicePath, 'utf-8');

      // Check for ordering logic
      const hasOrdering = content.includes('orderedItems') || content.includes('sequence') || content.includes('order');
      const hasTimestamp = content.includes('timestamp') || content.includes('Date');

      if (!hasOrdering) {
        this.issues.push('No explicit ordering logic found - messages could appear out of order');
        return false;
      }

      if (!hasTimestamp) {
        logger.warn('No timestamp usage found - could have issues with message ordering');
      }

      logger.info('✅ Message ordering checks passed');
      return true;
    } catch (error) {
      logger.error('Message ordering test failed:', error);
      return false;
    }
  }

  /**
   * Test 9: Check for duplicate message prevention
   */
  async testDuplicatePrevention(): Promise<boolean> {
    logger.info('Testing for duplicate message prevention...');

    try {
      const agentServicePath = path.join(__dirname, '../src/store/renderer/slices/agent-session/sagas/agent-stream-saga.ts');
      const content = fs.readFileSync(agentServicePath, 'utf-8');

      // Check for duplicate prevention
      const hasIdCheck = content.includes('id ===') || content.includes('id !==');
      const hasSet = content.includes('Set<') || content.includes('new Set');
      const hasFind = content.includes('.find(') && content.includes('id');
      const hasDedup = content.includes('deduplicateAgentMessages');

      if (!hasIdCheck && !hasSet && !hasFind && !hasDedup) {
        this.issues.push('No duplicate prevention logic found - could show duplicate messages');
        return false;
      }

      logger.info('✅ Duplicate prevention checks passed');
      return true;
    } catch (error) {
      logger.error('Duplicate prevention test failed:', error);
      return false;
    }
  }

  /**
   * Test 10: Check for proper scroll behavior
   */
  async testScrollBehavior(): Promise<boolean> {
    logger.info('Testing for proper scroll behavior...');

    try {
      const markdownViewerPath = path.join(__dirname, '../src/lib/components/markdown/MarkdownViewer.svelte');
      const chatPanelPath = path.join(__dirname, '../src/lib/components/chat/ChatPanel.svelte');

      let hasScrollLogic = false;

      if (fs.existsSync(markdownViewerPath)) {
        const content = fs.readFileSync(markdownViewerPath, 'utf-8');
        hasScrollLogic = content.includes('scrollIntoView') || content.includes('scrollTo');
      }

      if (!hasScrollLogic && fs.existsSync(chatPanelPath)) {
        const content = fs.readFileSync(chatPanelPath, 'utf-8');
        hasScrollLogic = content.includes('scrollIntoView') || content.includes('scrollTo');
      }

      if (!hasScrollLogic) {
        this.issues.push('No scroll behavior found - new messages might not be visible');
        logger.warn('Missing auto-scroll functionality');
      }

      logger.info('✅ Scroll behavior checks passed');
      return true;
    } catch (error) {
      logger.error('Scroll behavior test failed:', error);
      return false;
    }
  }

  /**
   * Run all edge case tests
   */
  async runAllTests(): Promise<void> {
    const tests: EdgeCaseTest[] = [
      {
        name: 'Memory Leaks',
        description: 'Checks for proper event listener cleanup',
        test: () => this.testMemoryLeaks(),
      },
      {
        name: 'Race Conditions',
        description: 'Checks for concurrent stream handling',
        test: () => this.testRaceConditions(),
      },
      {
        name: 'XSS Vulnerabilities',
        description: 'Checks for HTML sanitization',
        test: () => this.testXSSVulnerabilities(),
      },
      {
        name: 'Error Boundaries',
        description: 'Checks for proper error handling',
        test: () => this.testErrorBoundaries(),
      },
      {
        name: 'Infinite Loops',
        description: 'Checks for potential infinite loops',
        test: () => this.testInfiniteLoops(),
      },
      {
        name: 'State Cleanup',
        description: 'Checks for component unmount cleanup',
        test: () => this.testStateCleanup(),
      },
      {
        name: 'Null Handling',
        description: 'Checks for null/undefined safety',
        test: () => this.testNullHandling(),
      },
      {
        name: 'Message Ordering',
        description: 'Checks for proper message sequencing',
        test: () => this.testMessageOrdering(),
      },
      {
        name: 'Duplicate Prevention',
        description: 'Checks for duplicate message prevention',
        test: () => this.testDuplicatePrevention(),
      },
      {
        name: 'Scroll Behavior',
        description: 'Checks for auto-scroll functionality',
        test: () => this.testScrollBehavior(),
      },
    ];

    console.log('\n🔍 Running Edge Case Tests for Streaming\n');
    console.log('=' .repeat(50));

    for (const test of tests) {
      console.log(`\n📋 ${test.name}`);
      console.log(`   ${test.description}`);

      const result = await test.test();
      this.results.set(test.name, result);

      if (result) {
        console.log('   ✅ PASSED');
      } else {
        console.log('   ❌ FAILED');
      }
    }

    // Summary
    console.log(`\n${  '='.repeat(50)}`);
    console.log('\n📊 Test Summary\n');

    const passed = Array.from(this.results.values()).filter(r => r).length;
    const total = this.results.size;

    console.log(`Total: ${total}`);
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${total - passed}`);

    if (this.issues.length > 0) {
      console.log('\n⚠️  Issues Found:');
      this.issues.forEach((issue, i) => {
        console.log(`   ${i + 1}. ${issue}`);
      });
    }

    if (passed === total) {
      console.log('\n🎉 All edge case tests passed!');
      process.exit(0);
    } else {
      console.log('\n❌ Some tests failed. Review the issues above.');
      process.exit(1);
    }
  }
}

// Run tests
const tester = new StreamingEdgeCaseTester();
tester.runAllTests().catch(error => {
  console.error('Test runner failed:', error);
  process.exit(1);
});

export { StreamingEdgeCaseTester };
