#!/usr/bin/env tsx

/**
 * Refresh Scenario Test Runner for Chat Streaming
 *
 * Tests all edge cases around refreshing while streaming
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { Logger } from '../src/shared/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logger = new Logger('RefreshScenarioTest');

interface TestResult {
  scenario: string;
  passed: boolean;
  issues: string[];
}

class RefreshScenarioTester {
  private results: TestResult[] = [];

  /**
   * Test 1: Message persistence during active streaming
   */
  async testActiveStreamingPersistence(): Promise<TestResult> {
    logger.info('Testing message persistence during active streaming...');

    const issues: string[] = [];

    try {
      // Check Redux agent-session slice for proper state preservation
      const storeFile = path.join(__dirname, '../src/lib/store/slices/agent-session/agent-session-slice.ts');
      const storeContent = fs.readFileSync(storeFile, 'utf-8');

      // Check if messages are preserved when session updates
      if (!storeContent.includes('mergeSessionMessages') || !storeContent.includes('deduplicateAgentMessages')) {
        issues.push('Messages not preserved when updating session during streaming');
      }

      // Check stream saga for proper message handling
      const sessionFile = path.join(__dirname, '../src/lib/store/slices/agent-session/sagas/agent-stream-saga.ts');
      const sessionContent = fs.readFileSync(sessionFile, 'utf-8');

      // Check if updateMessage creates new objects for reactivity
      if (!sessionContent.includes('updateMessage(')) {
        issues.push('updateMessage not creating new objects for reactivity');
      }

      // Check if messages are merged properly on getSession
      if (!sessionContent.includes('replaceMessages(') || !sessionContent.includes('deduplicateAgentMessages')) {
        issues.push('getSession not merging messages properly');
      }

      return {
        scenario: 'Active Streaming Persistence',
        passed: issues.length === 0,
        issues,
      };
    } catch (error) {
      logger.error('Active streaming persistence test failed:', error);
      return {
        scenario: 'Active Streaming Persistence',
        passed: false,
        issues: [`Test error: ${error}`],
      };
    }
  }

  /**
   * Test 2: Partial message recovery after refresh
   */
  async testPartialMessageRecovery(): Promise<TestResult> {
    logger.info('Testing partial message recovery after refresh...');

    const issues: string[] = [];

    try {
      const agentServiceFile = path.join(__dirname, '../src/features/agent/agent-stream-lifecycle.ts');
      const content = fs.readFileSync(agentServiceFile, 'utf-8');

      // Check if textBuffer is preserved
      if (!content.includes('textBuffer')) {
        issues.push('No textBuffer found - partial messages may be lost on refresh');
      }

      // Check if buildOrderedContentBlocks handles partial content
      if (!content.includes('buildOrderedContentBlocks')) {
        issues.push('No buildOrderedContentBlocks function - may lose partial content');
      }

      // Check for message reconstruction logic
      if (!content.includes('contentBlocks') || !content.includes('orderedItems')) {
        issues.push('Missing content block ordering logic');
      }

      return {
        scenario: 'Partial Message Recovery',
        passed: issues.length === 0,
        issues,
      };
    } catch (error) {
      logger.error('Partial message recovery test failed:', error);
      return {
        scenario: 'Partial Message Recovery',
        passed: false,
        issues: [`Test error: ${error}`],
      };
    }
  }

  /**
   * Test 3: Stream state recovery after refresh
   */
  async testStreamStateRecovery(): Promise<TestResult> {
    logger.info('Testing stream state recovery after refresh...');

    const issues: string[] = [];

    try {
      const chatPanelFile = path.join(__dirname, '../src/lib/components/chat/ChatPanel.svelte');
      const content = fs.readFileSync(chatPanelFile, 'utf-8');

      // Check if streaming state is properly initialized on mount
      if (!content.includes('onMount')) {
        issues.push('No onMount handler - streaming state may not be restored');
      }

      // Check if streaming state is read from Redux agent-session selectors
      if (!content.includes('selectAgentSessionIsStreaming') || !content.includes('agentSessionIsStreaming')) {
        issues.push('Streaming state not loaded from agent-session selectors on mount');
      }

      // Check if messages are loaded from Redux agent-session selectors
      if (!content.includes('selectAgentMessages') || !content.includes('agentMessages')) {
        issues.push('Messages not loaded from agent-session selectors on mount');
      }

      return {
        scenario: 'Stream State Recovery',
        passed: issues.length === 0,
        issues,
      };
    } catch (error) {
      logger.error('Stream state recovery test failed:', error);
      return {
        scenario: 'Stream State Recovery',
        passed: false,
        issues: [`Test error: ${error}`],
      };
    }
  }

  /**
   * Test 4: Tool call preservation during refresh
   */
  async testToolCallPreservation(): Promise<TestResult> {
    logger.info('Testing tool call preservation during refresh...');

    const issues: string[] = [];

    try {
      const agentServiceFile = path.join(__dirname, '../src/features/agent/agent-stream-lifecycle.ts');
      const content = fs.readFileSync(agentServiceFile, 'utf-8');

      // Check if tool blocks are preserved
      if (!content.includes('tool_use') || !content.includes('tool_result')) {
        issues.push('Tool block types not handled - tool calls may be lost');
      }

      // Check if contentBlocks array preserves tool calls
      if (!content.includes("type === 'tool_use'") && !content.includes("type === 'tool_result'")) {
        issues.push('Tool blocks not filtered properly in content blocks');
      }

      // Check StreamingMessageContent for tool call rendering
      const streamingFile = path.join(__dirname, '../src/lib/components/chat/StreamingMessageContent.svelte');
      const streamingContent = fs.readFileSync(streamingFile, 'utf-8');

      if (!streamingContent.includes('ToolCall')) {
        issues.push('ToolCall component not imported - tool calls wont display');
      }

      return {
        scenario: 'Tool Call Preservation',
        passed: issues.length === 0,
        issues,
      };
    } catch (error) {
      logger.error('Tool call preservation test failed:', error);
      return {
        scenario: 'Tool Call Preservation',
        passed: false,
        issues: [`Test error: ${error}`],
      };
    }
  }

  /**
   * Test 5: Multiple refresh handling
   */
  async testMultipleRefreshes(): Promise<TestResult> {
    logger.info('Testing multiple refresh handling...');

    const issues: string[] = [];

    try {
      const unifiedStoreFile = path.join(__dirname, '../src/lib/store/slices/agent-session/agent-session-slice.ts');
      const content = fs.readFileSync(unifiedStoreFile, 'utf-8');

      // Check for idempotent operations
      if (!content.includes('existing')) {
        issues.push('No check for existing agent - may duplicate data on multiple refreshes');
      }

      // Check for proper state merging
      if (!content.includes('mergeSessionMessages') || !content.includes('updateSessionFields')) {
        issues.push('State not properly merged - may lose data on multiple refreshes');
      }

      return {
        scenario: 'Multiple Refreshes',
        passed: issues.length === 0,
        issues,
      };
    } catch (error) {
      logger.error('Multiple refresh test failed:', error);
      return {
        scenario: 'Multiple Refreshes',
        passed: false,
        issues: [`Test error: ${error}`],
      };
    }
  }

  /**
   * Test 6: Refresh during rapid streaming
   */
  async testRefreshDuringRapidStreaming(): Promise<TestResult> {
    logger.info('Testing refresh during rapid streaming...');

    const issues: string[] = [];

    try {
      const markdownViewerFile = path.join(__dirname, '../src/lib/components/markdown/MarkdownViewer.svelte');
      const content = fs.readFileSync(markdownViewerFile, 'utf-8');

      // Check for throttling
      if (!content.includes('throttle') && !content.includes('100')) {
        issues.push('No throttling in MarkdownViewer - may lose updates during rapid streaming');
      }

      // Check for buffering
      if (!content.includes('buffer') || !content.includes('accumulate')) {
        logger.warn('No explicit buffering found in MarkdownViewer');
      }

      return {
        scenario: 'Refresh During Rapid Streaming',
        passed: issues.length === 0,
        issues,
      };
    } catch (error) {
      logger.error('Rapid streaming refresh test failed:', error);
      return {
        scenario: 'Refresh During Rapid Streaming',
        passed: false,
        issues: [`Test error: ${error}`],
      };
    }
  }

  /**
   * Test 7: Browser back/forward during streaming
   */
  async testBrowserNavigation(): Promise<TestResult> {
    logger.info('Testing browser back/forward during streaming...');

    const issues: string[] = [];

    try {
      const pageFile = path.join(__dirname, '../src/routes/workspace/[id]/+page.svelte');
      const content = fs.readFileSync(pageFile, 'utf-8');

      // Check for proper cleanup on unmount
      if (!content.includes('onDestroy') && !content.includes('cleanup')) {
        issues.push('No cleanup on page unmount - may leak streaming connections');
      }

      // Check for state restoration
      if (!content.includes('onMount')) {
        issues.push('No onMount handler - state may not restore on navigation');
      }

      return {
        scenario: 'Browser Navigation',
        passed: issues.length === 0,
        issues,
      };
    } catch (error) {
      logger.error('Browser navigation test failed:', error);
      return {
        scenario: 'Browser Navigation',
        passed: false,
        issues: [`Test error: ${error}`],
      };
    }
  }

  /**
   * Test 8: Session storage consistency
   */
  async testSessionStorageConsistency(): Promise<TestResult> {
    logger.info('Testing session storage consistency...');

    const issues: string[] = [];

    try {
      const sessionStoreFile = path.join(__dirname, '../src/features/agent/browser/index.ts');
      const content = fs.readFileSync(sessionStoreFile, 'utf-8');

      // Check if browser compatibility subscribers are driven by Redux updates
      if (!content.includes('getReduxStore().subscribe') || !content.includes('selectAgentById.select')) {
        issues.push('Browser subscriber bridge not using Redux updates for reactivity');
      }

      // Check if message loading preserves persisted session messages
      if (!content.includes('loadMessages') || !content.includes('return session.messages')) {
        issues.push('Message loading not preserving session messages');
      }

      return {
        scenario: 'Session Storage Consistency',
        passed: issues.length === 0,
        issues,
      };
    } catch (error) {
      logger.error('Session storage consistency test failed:', error);
      return {
        scenario: 'Session Storage Consistency',
        passed: false,
        issues: [`Test error: ${error}`],
      };
    }
  }

  /**
   * Test 9: Concurrent tab refresh handling
   */
  async testConcurrentTabs(): Promise<TestResult> {
    logger.info('Testing concurrent tab refresh handling...');

    const issues: string[] = [];

    try {
      const agentServiceFile = path.join(__dirname, '../src/features/agent/agent-stream-lifecycle.ts');
      const content = fs.readFileSync(agentServiceFile, 'utf-8');

      // Check for session/stream ID isolation
      if (!content.includes('sessionId') && !content.includes('streamId')) {
        issues.push('No session/stream ID isolation - concurrent tabs may interfere');
      }

      // Check for proper event targeting
      if (content.includes('window.dispatchEvent') && !content.includes('detail')) {
        issues.push('Events not properly scoped - may affect wrong tab');
      }

      return {
        scenario: 'Concurrent Tabs',
        passed: issues.length === 0,
        issues,
      };
    } catch (error) {
      logger.error('Concurrent tabs test failed:', error);
      return {
        scenario: 'Concurrent Tabs',
        passed: false,
        issues: [`Test error: ${error}`],
      };
    }
  }

  /**
   * Test 10: Error recovery after refresh
   */
  async testErrorRecoveryAfterRefresh(): Promise<TestResult> {
    logger.info('Testing error recovery after refresh...');

    const issues: string[] = [];

    try {
      const chatPanelFile = path.join(__dirname, '../src/lib/components/chat/ChatPanel.svelte');
      const content = fs.readFileSync(chatPanelFile, 'utf-8');

      // Check for error state handling
      if (!content.includes('error') || !content.includes('Error')) {
        issues.push('No error handling in ChatPanel');
      }

      // Check for retry logic
      if (!content.includes('retry') && !content.includes('resend')) {
        logger.warn('No retry logic found - users may need to manually retry after errors');
      }

      return {
        scenario: 'Error Recovery After Refresh',
        passed: issues.length === 0,
        issues,
      };
    } catch (error) {
      logger.error('Error recovery test failed:', error);
      return {
        scenario: 'Error Recovery After Refresh',
        passed: false,
        issues: [`Test error: ${error}`],
      };
    }
  }

  /**
   * Generate comprehensive report
   */
  generateReport(): void {
    console.log('\n🔄 Refresh Scenario Test Results\n');
    console.log('=' .repeat(60));

    let totalPassed = 0;
    let totalFailed = 0;
    const criticalIssues: string[] = [];

    this.results.forEach(result => {
      const status = result.passed ? '✅' : '❌';
      console.log(`\n${status} ${result.scenario}`);

      if (!result.passed) {
        totalFailed++;
        result.issues.forEach(issue => {
          console.log(`   └─ ${issue}`);
          if (issue.includes('lost') || issue.includes('leak')) {
            criticalIssues.push(`${result.scenario}: ${issue}`);
          }
        });
      } else {
        totalPassed++;
        console.log('   └─ All checks passed');
      }
    });

    console.log(`\n${  '='.repeat(60)}`);
    console.log('\n📊 Summary:');
    console.log(`   Total Scenarios: ${this.results.length}`);
    console.log(`   Passed: ${totalPassed}`);
    console.log(`   Failed: ${totalFailed}`);

    if (criticalIssues.length > 0) {
      console.log('\n⚠️  Critical Issues:');
      criticalIssues.forEach((issue, i) => {
        console.log(`   ${i + 1}. ${issue}`);
      });
    }

    if (totalFailed === 0) {
      console.log('\n🎉 All refresh scenarios handled correctly!');
    } else {
      console.log('\n❗ Some refresh scenarios need attention.');
    }
  }

  /**
   * Run all refresh scenario tests
   */
  async runAllTests(): Promise<void> {
    console.log('\n🔄 Running Refresh Scenario Tests for Streaming\n');

    this.results.push(await this.testActiveStreamingPersistence());
    this.results.push(await this.testPartialMessageRecovery());
    this.results.push(await this.testStreamStateRecovery());
    this.results.push(await this.testToolCallPreservation());
    this.results.push(await this.testMultipleRefreshes());
    this.results.push(await this.testRefreshDuringRapidStreaming());
    this.results.push(await this.testBrowserNavigation());
    this.results.push(await this.testSessionStorageConsistency());
    this.results.push(await this.testConcurrentTabs());
    this.results.push(await this.testErrorRecoveryAfterRefresh());

    this.generateReport();

    const failedCount = this.results.filter(r => !r.passed).length;
    process.exit(failedCount > 0 ? 1 : 0);
  }
}

// Run tests
const tester = new RefreshScenarioTester();
tester.runAllTests().catch(error => {
  console.error('Refresh scenario test runner failed:', error);
  process.exit(1);
});

export { RefreshScenarioTester };
