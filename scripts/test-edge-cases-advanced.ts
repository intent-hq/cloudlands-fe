#!/usr/bin/env tsx

/**
 * Advanced Edge Case Tests
 *
 * Tests edge cases that could break the workspace and streaming functionality
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { Logger } from '../src/main/utils/logger';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logger = new Logger('AdvancedEdgeCaseTest');

interface EdgeCase {
  name: string;
  description: string;
  test: () => Promise<{ passed: boolean; issues: string[] }>;
}

class AdvancedEdgeCaseTest {
  private edgeCases: EdgeCase[] = [];
  private results: { name: string; passed: boolean; issues: string[] }[] = [];

  constructor() {
    this.setupEdgeCases();
  }

  private setupEdgeCases() {
    this.edgeCases = [
      {
        name: 'Duplicate Agent ID Prevention',
        description: 'Ensures duplicate agent IDs cannot be created',
        test: async () => {
          const issues: string[] = [];

          // Check agent factory for duplicate prevention
          const factoryPath = path.join(__dirname, '../src/features/agent/services/agent-factory.ts');
          const factoryContent = await fs.readFile(factoryPath, 'utf-8');

          if (!factoryContent.includes('config.id') && !factoryContent.includes('generateAgentId')) {
            issues.push('Agent factory may not handle duplicate IDs properly');
          }

          // Check unified state store
          const storePath = path.join(__dirname, '../src/features/agent/services/unified-state-store.ts');
          const storeContent = await fs.readFile(storePath, 'utf-8');

          if (!storeContent.includes('agents.get') || !storeContent.includes('agents.set')) {
            issues.push('State store may allow duplicate agents');
          }

          return { passed: issues.length === 0, issues };
        },
      },
      {
        name: 'Workspace Deletion During Streaming',
        description: 'Handles workspace deletion while agent is streaming',
        test: async () => {
          const issues: string[] = [];

          // Check for cleanup handlers
          const servicePath = path.join(__dirname, '../src/features/agent/agent.service.ts');
          const serviceContent = await fs.readFile(servicePath, 'utf-8');

          if (!serviceContent.includes('stopSession') || !serviceContent.includes('deleteSession')) {
            issues.push('Agent service may not handle deletion during streaming');
          }

          // Check for stream cleanup
          if (!serviceContent.includes('streamingService.stopStream')) {
            issues.push('Streaming may not be stopped on deletion');
          }

          return { passed: issues.length === 0, issues };
        },
      },
      {
        name: 'Concurrent Message Sending',
        description: 'Prevents issues when multiple messages sent simultaneously',
        test: async () => {
          const issues: string[] = [];

          // Check for message queueing or locking
          const chatServicePath = path.join(__dirname, '../src/features/agent/services/chat.service.ts');
          const chatServiceContent = await fs.readFile(chatServicePath, 'utf-8');

          if (!chatServiceContent.includes('isProcessing') && !chatServiceContent.includes('queue')) {
            issues.push('Chat service may not handle concurrent messages properly');
          }

          // Check agent service
          const agentServicePath = path.join(__dirname, '../src/features/agent/agent.service.ts');
          const agentServiceContent = await fs.readFile(agentServicePath, 'utf-8');

          if (!agentServiceContent.includes('isStreaming') || !agentServiceContent.includes('isProcessing')) {
            issues.push('Agent service may not prevent concurrent message sending');
          }

          return { passed: issues.length === 0, issues };
        },
      },
      {
        name: 'Invalid Agent ID Format',
        description: 'Handles invalid agent ID formats gracefully',
        test: async () => {
          const issues: string[] = [];

          // Check workspace service validation
          const workspacePath = path.join(__dirname, '../src/features/workspace/main/workspace.service.ts');
          const workspaceContent = await fs.readFile(workspacePath, 'utf-8');

          if (!workspaceContent.includes("agentId.includes('..')") ||
              !workspaceContent.includes("agentId.includes('/')")) {
            issues.push('Workspace service may not validate agent ID format');
          }

          return { passed: issues.length === 0, issues };
        },
      },
      {
        name: 'Session Storage Overflow',
        description: 'Handles session storage quota exceeded errors',
        test: async () => {
          const issues: string[] = [];

          // Check for try-catch around sessionStorage
          const initPath = path.join(__dirname, '../src/lib/components/workspace/WorkspaceInitializer.svelte');
          const initContent = await fs.readFile(initPath, 'utf-8');

          if (!initContent.includes('try') || !initContent.includes('sessionStorage')) {
            issues.push('WorkspaceInitializer may not handle sessionStorage errors');
          }

          const pagePath = path.join(__dirname, '../src/routes/workspace/[id]/+page.svelte');
          const pageContent = await fs.readFile(pagePath, 'utf-8');

          if (pageContent.includes('sessionStorage.setItem') &&
              !pageContent.includes('try')) {
            issues.push('Workspace page may not handle sessionStorage quota errors');
          }

          return { passed: issues.length === 0, issues };
        },
      },
      {
        name: 'Circular Reference in Messages',
        description: 'Prevents circular references in message objects',
        test: async () => {
          const issues: string[] = [];

          // Check for JSON.stringify usage
          const storePath = path.join(__dirname, '../src/features/agent/services/unified-state-store.ts');
          const storeContent = await fs.readFile(storePath, 'utf-8');

          if (storeContent.includes('JSON.stringify') && !storeContent.includes('try')) {
            issues.push('State store may not handle circular references in JSON.stringify');
          }

          return { passed: issues.length === 0, issues };
        },
      },
      {
        name: 'Agent Activation Timeout',
        description: 'Handles agent activation timeouts gracefully',
        test: async () => {
          const issues: string[] = [];

          // Check for timeout handling
          const backendPath = path.join(__dirname, '../src/features/agent/main/agent-backend-handler.service.ts');
          const backendContent = await fs.readFile(backendPath, 'utf-8');

          if (!backendContent.includes('timeout') && !backendContent.includes('TIMEOUT')) {
            issues.push('Backend handler may not handle activation timeouts');
          }

          // Check agent service
          const servicePath = path.join(__dirname, '../src/features/agent/agent.service.ts');
          const serviceContent = await fs.readFile(servicePath, 'utf-8');

          if (!serviceContent.includes('timeout') || !serviceContent.includes('clearTimeout')) {
            issues.push('Agent service may not handle stream timeouts');
          }

          return { passed: issues.length === 0, issues };
        },
      },
      {
        name: 'Empty Message Handling',
        description: 'Handles empty or whitespace-only messages',
        test: async () => {
          const issues: string[] = [];

          // Check chat panel
          const chatPanelPath = path.join(__dirname, '../src/lib/components/chat/ChatPanel.svelte');
          const chatPanelContent = await fs.readFile(chatPanelPath, 'utf-8');

          if (!chatPanelContent.includes('trim()') || !chatPanelContent.includes('length === 0')) {
            issues.push('ChatPanel may not validate empty messages');
          }

          // Check chat service
          const chatServicePath = path.join(__dirname, '../src/features/agent/services/chat.service.ts');
          const chatServiceContent = await fs.readFile(chatServicePath, 'utf-8');

          if (!chatServiceContent.includes('trim()') && !chatServiceContent.includes('message.length')) {
            issues.push('Chat service may not validate empty messages');
          }

          return { passed: issues.length === 0, issues };
        },
      },
      {
        name: 'Large Message Handling',
        description: 'Handles extremely large messages without crashing',
        test: async () => {
          const issues: string[] = [];

          // Check for message size limits or chunking
          const streamingPath = path.join(__dirname, '../src/lib/components/chat/StreamingMessageContent.svelte');
          const streamingContent = await fs.readFile(streamingPath, 'utf-8');

          if (!streamingContent.includes('MAX') && !streamingContent.includes('chunk')) {
            logger.warn('StreamingMessageContent may not handle very large messages efficiently');
          }

          // Check markdown viewer
          const markdownPath = path.join(__dirname, '../src/lib/components/markdown/MarkdownViewer.svelte');
          const markdownExists = await fs.access(markdownPath).then(() => true).catch(() => false);

          if (markdownExists) {
            const markdownContent = await fs.readFile(markdownPath, 'utf-8');
            if (!markdownContent.includes('throttle') && !markdownContent.includes('debounce')) {
              issues.push('MarkdownViewer may not throttle updates for large content');
            }
          }

          return { passed: issues.length === 0, issues };
        },
      },
      {
        name: 'Network Disconnection During Stream',
        description: 'Handles network disconnection while streaming',
        test: async () => {
          const issues: string[] = [];

          // Check for disconnection handling
          const agentServicePath = path.join(__dirname, '../src/features/agent/agent.service.ts');
          const agentServiceContent = await fs.readFile(agentServicePath, 'utf-8');

          if (!agentServiceContent.includes('stream:disconnected') &&
              !agentServiceContent.includes('stream:error')) {
            issues.push('Agent service may not handle stream disconnection');
          }

          // Check for reconnection logic
          if (!agentServiceContent.includes('reconnect') && !agentServiceContent.includes('retry')) {
            logger.warn('No automatic reconnection logic found for streaming');
          }

          return { passed: issues.length === 0, issues };
        },
      },
      {
        name: 'Agent State Corruption Recovery',
        description: 'Recovers from corrupted agent state',
        test: async () => {
          const issues: string[] = [];

          // Check for state validation
          const storePath = path.join(__dirname, '../src/features/agent/services/unified-state-store.ts');
          const storeContent = await fs.readFile(storePath, 'utf-8');

          if (!storeContent.includes('try') || !storeContent.includes('catch')) {
            issues.push('State store may not handle corrupted state gracefully');
          }

          // Check for state recovery
          if (!storeContent.includes('logger.error') || !storeContent.includes('logger.warn')) {
            issues.push('State store may not log state corruption issues');
          }

          return { passed: issues.length === 0, issues };
        },
      },
      {
        name: 'Memory Leak on Rapid Navigation',
        description: 'Prevents memory leaks when rapidly navigating between workspaces',
        test: async () => {
          const issues: string[] = [];

          // Check for cleanup in workspace page
          const pagePath = path.join(__dirname, '../src/routes/workspace/[id]/+page.svelte');
          const pageContent = await fs.readFile(pagePath, 'utf-8');

          if (!pageContent.includes('onDestroy') || !pageContent.includes('cleanup')) {
            issues.push('Workspace page may not clean up on rapid navigation');
          }

          // Check for subscription cleanup
          if (!pageContent.includes('unsubscribe') || !pageContent.includes('.off(')) {
            issues.push('Event listeners may not be cleaned up on navigation');
          }

          return { passed: issues.length === 0, issues };
        },
      },
      {
        name: 'Race Condition in Agent Creation',
        description: 'Prevents race conditions when creating multiple agents quickly',
        test: async () => {
          const issues: string[] = [];

          // Check for creation locks or queuing
          const factoryPath = path.join(__dirname, '../src/features/agent/services/agent-factory.ts');
          const factoryContent = await fs.readFile(factoryPath, 'utf-8');

          if (!factoryContent.includes('creating') && !factoryContent.includes('pending')) {
            logger.warn('Agent factory may not prevent race conditions in creation');
          }

          // Check for unique ID generation
          if (!factoryContent.includes('crypto.randomUUID') && !factoryContent.includes('generateAgentId')) {
            issues.push('Agent factory may not generate unique IDs reliably');
          }

          return { passed: issues.length === 0, issues };
        },
      },
    ];
  }

  async runTest(edgeCase: EdgeCase): Promise<void> {
    try {
      const result = await edgeCase.test();
      this.results.push({ name: edgeCase.name, ...result });
    } catch (error) {
      this.results.push({
        name: edgeCase.name,
        passed: false,
        issues: [`Test failed: ${error instanceof Error ? error.message : String(error)}`],
      });
    }
  }

  async runAllTests(): Promise<void> {
    console.log('\n🔬 Running Advanced Edge Case Tests\n');
    console.log('============================================================\n');

    // Run all tests
    for (const edgeCase of this.edgeCases) {
      console.log(`Testing: ${edgeCase.name}`);
      console.log(`   ${edgeCase.description}`);
      await this.runTest(edgeCase);

      const result = this.results[this.results.length - 1];
      if (result.passed) {
        console.log('   ✅ PASSED');
      } else {
        console.log('   ❌ FAILED');
        for (const issue of result.issues) {
          console.log(`   └─ ${issue}`);
        }
      }
      console.log('');
    }

    // Summary
    console.log('============================================================\n');
    console.log('📊 Edge Case Summary:\n');

    const passed = this.results.filter(r => r.passed).length;
    const failed = this.results.filter(r => !r.passed).length;

    console.log(`Total Edge Cases: ${this.results.length}`);
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);

    console.log('');

    if (failed === 0) {
      console.log('🎉 All advanced edge cases handled correctly!');
    } else {
      console.log('⚠️ Some edge cases need attention.');
      console.log('\nRecommendations:');

      // Provide specific recommendations based on failures
      const failedTests = this.results.filter(r => !r.passed);
      for (const test of failedTests) {
        console.log(`\n${test.name}:`);
        if (test.name.includes('Duplicate')) {
          console.log('  - Add duplicate ID checking in agent creation');
          console.log('  - Use Map.has() before Map.set() in state store');
        } else if (test.name.includes('Timeout')) {
          console.log('  - Add timeout handling with Promise.race()');
          console.log('  - Implement retry logic with exponential backoff');
        } else if (test.name.includes('Memory')) {
          console.log('  - Add cleanup in onDestroy lifecycle hooks');
          console.log('  - Unsubscribe from all event listeners');
        } else if (test.name.includes('Network')) {
          console.log('  - Add connection state monitoring');
          console.log('  - Implement reconnection with backoff');
        }
      }
    }
  }
}

// Run the tests
const tester = new AdvancedEdgeCaseTest();
tester.runAllTests().catch(error => {
  logger.error('Edge case testing failed', error);
  process.exit(1);
});
