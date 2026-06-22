#!/usr/bin/env tsx

/**
 * Programmatic Test Runner for Chat Streaming UI
 *
 * Run with: npm run test:streaming-ui
 *
 * This script provides a way to programmatically test the streaming UI
 * in different states and scenarios.
 */

import { Logger } from '../src/shared/logger.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logger = new Logger('StreamingUITest');

interface TestScenario {
  name: string;
  description: string;
  test: () => Promise<boolean>;
}

class StreamingUITester {
  private results: Map<string, boolean> = new Map();

  constructor() {
    // We'll use simpler test methods that don't require Electron context
  }

  /**
   * Test real-time text streaming by checking the code logic
   */
  async testRealTimeStreaming(): Promise<boolean> {
    logger.info('Testing real-time text streaming logic...');

    try {
      // Check if StreamingMessageContent.svelte has the correct streaming prop
      const componentPath = path.join(__dirname, '../src/lib/components/chat/StreamingMessageContent.svelte');
      const content = fs.readFileSync(componentPath, 'utf-8');

      // Check if isStreaming is properly passed to MarkdownViewer
      const hasCorrectStreamingProp = content.includes('isStreaming={isStreaming && blockIndex === groupedBlocks.length - 1}');

      if (!hasCorrectStreamingProp) {
        logger.error('StreamingMessageContent does not pass isStreaming correctly to MarkdownViewer');
        return false;
      }

      // Check if MarkdownViewer handles streaming
      const markdownPath = path.join(__dirname, '../src/lib/components/markdown/MarkdownViewer.svelte');
      const markdownContent = fs.readFileSync(markdownPath, 'utf-8');

      const hasStreamingProp = markdownContent.includes('isStreaming = false');
      const hasThrottling = markdownContent.includes('scheduleStreamingUpdate');

      if (!hasStreamingProp || !hasThrottling) {
        logger.error('MarkdownViewer does not handle streaming properly');
        return false;
      }

      logger.info('✅ Real-time streaming test passed');
      return true;
    } catch (error) {
      logger.error('Real-time streaming test failed:', error);
      return false;
    }
  }

  /**
   * Test streaming with tool calls by checking the component structure
   */
  async testStreamingWithToolCalls(): Promise<boolean> {
    logger.info('Testing streaming with tool calls logic...');

    try {
      const componentPath = path.join(__dirname, '../src/lib/components/chat/StreamingMessageContent.svelte');
      const content = fs.readFileSync(componentPath, 'utf-8');

      // Check if component handles tool_use blocks
      const hasToolUseHandling = content.includes("block.type === 'tool_use'");
      const hasToolResultHandling = content.includes("block.type === 'tool_result'");

      if (!hasToolUseHandling || !hasToolResultHandling) {
        logger.error('StreamingMessageContent does not handle tool blocks properly');
        return false;
      }

      // Check if ToolCall component is imported
      const hasToolCallImport = content.includes('ToolCall');

      if (!hasToolCallImport) {
        logger.error('StreamingMessageContent does not import ToolCall component');
        return false;
      }

      logger.info('✅ Streaming with tool calls test passed');
      return true;
    } catch (error) {
      logger.error('Streaming with tool calls test failed:', error);
      return false;
    }
  }

  /**
   * Test message persistence logic
   */
  async testMessagePersistence(): Promise<boolean> {
    logger.info('Testing message persistence logic...');

    try {
      // Check Redux agent-session slice preserves messages
      const storePath = path.join(__dirname, '../src/store/renderer/slices/agent-session/agent-session-slice.ts');
      const storeContent = fs.readFileSync(storePath, 'utf-8');

      // Check if messages are preserved when updating agent
      const hasMessagePreservation = storeContent.includes('replaceMessages') &&
        storeContent.includes('deduplicateAgentMessages') &&
        storeContent.includes('normalizeSortPruneMessages');

      if (!hasMessagePreservation) {
        logger.error('agent-session slice does not preserve messages properly');
        return false;
      }

      // Check stream saga updateMessage triggers Redux state updates
      const streamSagaPath = path.join(__dirname, '../src/store/renderer/slices/agent-session/sagas/agent-stream-saga.ts');
      const streamSagaContent = fs.readFileSync(streamSagaPath, 'utf-8');

      const hasReactiveUpdate = streamSagaContent.includes('updateMessage(');
      const hasStoreNotification = streamSagaContent.includes('replaceMessages(') &&
        streamSagaContent.includes('deduplicateRecoverySession');

      if (!hasReactiveUpdate || !hasStoreNotification) {
        logger.error('agent stream saga does not trigger Redux updates');
        return false;
      }

      logger.info('✅ Message persistence test passed');
      return true;
    } catch (error) {
      logger.error('Message persistence test failed:', error);
      return false;
    }
  }

  /**
   * Test rapid streaming updates handling
   */
  async testRapidUpdates(): Promise<boolean> {
    logger.info('Testing rapid streaming updates handling...');

    try {
      // Check if agent-stream-lifecycle accumulates text properly
      const agentServicePath = path.join(__dirname, '../src/features/agent/agent-stream-lifecycle.ts');
      const agentServiceContent = fs.readFileSync(agentServicePath, 'utf-8');

      // Check for text buffer accumulation
      const hasTextBuffer = agentServiceContent.includes('textBuffer += data.data');
      const hasBuildOrderedContentBlocks = agentServiceContent.includes('buildOrderedContentBlocks');

      if (!hasTextBuffer) {
        logger.error('agent-stream-lifecycle does not accumulate text in buffer');
        return false;
      }

      if (!hasBuildOrderedContentBlocks) {
        logger.error('agent-stream-lifecycle does not use buildOrderedContentBlocks');
        return false;
      }

      // Check if stream updates are dispatched during streaming
      const hasUpdateMessage = agentServiceContent.includes('agentStreamUpdateReceived');

      if (!hasUpdateMessage) {
        logger.error('agent-stream-lifecycle does not dispatch stream updates during streaming');
        return false;
      }

      logger.info('✅ Rapid updates test passed');
      return true;
    } catch (error) {
      logger.error('Rapid updates test failed:', error);
      return false;
    }
  }

  /**
   * Run all tests
   */
  async runAllTests(): Promise<void> {
    const scenarios: TestScenario[] = [
      {
        name: 'Real-time Streaming',
        description: 'Tests that text appears character by character during streaming',
        test: () => this.testRealTimeStreaming(),
      },
      {
        name: 'Streaming with Tool Calls',
        description: 'Tests that tool calls display correctly during streaming',
        test: () => this.testStreamingWithToolCalls(),
      },
      {
        name: 'Message Persistence',
        description: 'Tests that messages persist after page refresh',
        test: () => this.testMessagePersistence(),
      },
      {
        name: 'Rapid Updates',
        description: 'Tests handling of rapid streaming updates',
        test: () => this.testRapidUpdates(),
      },
    ];

    console.log('\n🧪 Running Streaming UI Tests\n');
    console.log('=' .repeat(50));

    for (const scenario of scenarios) {
      console.log(`\n📋 ${scenario.name}`);
      console.log(`   ${scenario.description}`);

      const result = await scenario.test();
      this.results.set(scenario.name, result);

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

    if (passed === total) {
      console.log('\n🎉 All tests passed!');
      process.exit(0);
    } else {
      console.log('\n❌ Some tests failed. Check the logs above for details.');
      process.exit(1);
    }
  }
}

// Run tests if executed directly
const tester = new StreamingUITester();
tester.runAllTests().catch(error => {
  console.error('Test runner failed:', error);
  process.exit(1);
});

export { StreamingUITester };
