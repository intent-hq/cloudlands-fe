#!/usr/bin/env tsx

/**
 * Test Workspace Creation Flow
 *
 * Tests the complete workspace creation flow including:
 * - Workspace creation
 * - Initial agent creation
 * - Agent activation
 * - Message sending
 * - Streaming functionality
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { Logger } from '../src/main/utils/logger';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logger = new Logger('WorkspaceCreationTest');

interface TestResult {
  name: string;
  passed: boolean;
  issues: string[];
  warnings?: string[];
}

class WorkspaceCreationTest {
  private results: TestResult[] = [];

  /**
   * Test workspace creation configuration
   */
  async testWorkspaceCreation(): Promise<TestResult> {
    const issues: string[] = [];
    const warnings: string[] = [];

    try {
      // Check active compact workspace initializer component
      const initializerPath = path.join(__dirname, '../src/lib/components/workspace/CompactWorkspaceInitializer.svelte');
      const initializerContent = await fs.readFile(initializerPath, 'utf-8');

      // Check for initial agent ID generation
      if (!initializerContent.includes('unifiedIdService.generateAgentId()')) {
        issues.push('Initial agent ID not generated properly');
      }

      // Check for initial agent configuration
      if (!initializerContent.includes('initialAgent')) {
        issues.push('Initial agent configuration not found');
      }

      // Check workspace service
      const servicePath = path.join(__dirname, '../src/features/workspace/main/workspace.service.ts');
      const serviceContent = await fs.readFile(servicePath, 'utf-8');

      // Check for initial agent handling
      if (!serviceContent.includes('request.initialAgent')) {
        issues.push('Workspace service does not handle initial agent');
      }

      // Check for agent persistence
      if (!serviceContent.includes('agents') && !serviceContent.includes('.json')) {
        issues.push('Initial agent not persisted to disk');
      }

      // Check for pending status
      if (!serviceContent.includes('AgentStatus.Pending')) {
        warnings.push('Initial agent not set to pending status');
      }

    } catch (error) {
      issues.push(`Failed to test workspace creation: ${error}`);
    }

    return {
      name: 'Workspace Creation',
      passed: issues.length === 0,
      issues,
      warnings,
    };
  }

  /**
   * Test initial agent creation
   */
  async testInitialAgentCreation(): Promise<TestResult> {
    const issues: string[] = [];
    const warnings: string[] = [];

    try {
      // Check agent factory
      const factoryPath = path.join(__dirname, '../src/features/agent/services/agent-factory.ts');
      const factoryContent = await fs.readFile(factoryPath, 'utf-8');

      // Check for workspace-initializer source handling
      if (!factoryContent.includes('workspace-initializer')) {
        issues.push('Agent factory does not handle workspace-initializer source');
      }

      // The initial-agent flag is set while persisting the pending initial agent config.
      const servicePath = path.join(__dirname, '../src/features/workspace/main/workspace.service.ts');
      const serviceContent = await fs.readFile(servicePath, 'utf-8');

      // Check for initial agent metadata preservation
      if (!serviceContent.includes('isInitialAgent') || !serviceContent.includes('metadata')) {
        issues.push('Workspace service does not preserve isInitialAgent metadata');
      }

      // Check for agent ID preservation
      if (!serviceContent.includes('request.initialAgent.agentId')) {
        issues.push('Workspace service does not preserve pre-generated agent ID');
      }

    } catch (error) {
      issues.push(`Failed to test initial agent creation: ${error}`);
    }

    return {
      name: 'Initial Agent Creation',
      passed: issues.length === 0,
      issues,
      warnings,
    };
  }

  /**
   * Test agent activation flow
   */
  async testAgentActivation(): Promise<TestResult> {
    const issues: string[] = [];
    const warnings: string[] = [];

    try {
      // Check backend handler
      const handlerPath = path.join(__dirname, '../src/features/agent/main/agent-backend-handler.service.ts');
      const handlerContent = await fs.readFile(handlerPath, 'utf-8');

      // Check for activate handler
      if (!handlerContent.includes('handleActivate')) {
        issues.push('Backend handler missing activate handler');
      }

      // Check for agent ID usage in activation
      if (!handlerContent.includes('agent.id') || !handlerContent.includes('backendSessionId')) {
        warnings.push('Backend handler may not properly handle agent ID as session ID');
      }

      // Check workspace page
      const pagePath = path.join(__dirname, '../src/routes/workspace/[id]/+page.svelte');
      const pageContent = await fs.readFile(pagePath, 'utf-8');

      // Check for initial agent handling
      if (!pageContent.includes('initialAgentId')) {
        issues.push('Workspace page does not handle initial agent ID');
      }

      // Check for agent restoration
      if (!pageContent.includes('resumeSession') || !pageContent.includes('restoreAgent')) {
        warnings.push('Workspace page may not properly restore initial agent');
      }

      // Check for isInitialAgent flag handling
      if (!pageContent.includes('isInitialAgent')) {
        warnings.push('Workspace page may not preserve isInitialAgent flag');
      }

    } catch (error) {
      issues.push(`Failed to test agent activation: ${error}`);
    }

    return {
      name: 'Agent Activation',
      passed: issues.length === 0,
      issues,
      warnings,
    };
  }

  /**
   * Test message sending to initial agent
   */
  async testMessageSending(): Promise<TestResult> {
    const issues: string[] = [];
    const warnings: string[] = [];

    try {
      // Check ChatPanel component
      const chatPanelPath = path.join(__dirname, '../src/lib/components/chat/ChatPanel.svelte');
      const chatPanelContent = await fs.readFile(chatPanelPath, 'utf-8');

      // Check for Redux-backed chat initialization on mount
      if (!chatPanelContent.includes('initializeChatRequested')) {
        issues.push('ChatPanel does not initialize chat state on mount');
      }

      // Check for streaming state restoration
      if (!chatPanelContent.includes('agentSessionIsStreaming')) {
        warnings.push('ChatPanel may not restore streaming state');
      }

      // Check for message persistence
      if (!chatPanelContent.includes('agentMessages')) {
        issues.push('ChatPanel does not restore messages on mount');
      }

      // Initial-message dispatch is owned by the Redux chat-state slice and saga graph.
      const chatStatePath = path.join(__dirname, '../src/store/renderer/slices/chat-state/chat-state-slice.ts');
      const chatStateContent = await fs.readFile(chatStatePath, 'utf-8');

      if (!chatStateContent.includes('sendInitialMessageRequested')) {
        warnings.push('Chat state slice may not expose initial message handling');
      }

    } catch (error) {
      issues.push(`Failed to test message sending: ${error}`);
    }

    return {
      name: 'Message Sending',
      passed: issues.length === 0,
      issues,
      warnings,
    };
  }

  /**
   * Test streaming functionality for initial agent
   */
  async testStreamingFunctionality(): Promise<TestResult> {
    const issues: string[] = [];
    const warnings: string[] = [];

    try {
      // Check streaming message content
      const streamingPath = path.join(__dirname, '../src/lib/components/chat/StreamingMessageContent.svelte');
      const streamingContent = await fs.readFile(streamingPath, 'utf-8');

      // Check for proper streaming state passing
      if (!streamingContent.includes('isStreaming={isStreaming')) {
        issues.push('StreamingMessageContent does not properly pass streaming state');
      }

      // Check for cleanup
      if (!streamingContent.includes('onDestroy')) {
        warnings.push('StreamingMessageContent may not clean up properly');
      }

      // Check Redux session store
      const storePath = path.join(__dirname, '../src/store/renderer/slices/agent-session/agent-session-slice.ts');
      const storeContent = await fs.readFile(storePath, 'utf-8');

      // Check for state merging
      if (!storeContent.includes('upsertSession') || !storeContent.includes('existing')) {
        issues.push('Agent session store does not properly merge existing agent state');
      }

      // Check for message preservation
      if (!storeContent.includes('replaceMessages') || !storeContent.includes('deduplicateAgentMessages')) {
        issues.push('Agent session store does not preserve messages during updates');
      }

    } catch (error) {
      issues.push(`Failed to test streaming functionality: ${error}`);
    }

    return {
      name: 'Streaming Functionality',
      passed: issues.length === 0,
      issues,
      warnings,
    };
  }

  /**
   * Test empty-chat welcome message display
   */
  async testEmptyChatWelcome(): Promise<TestResult> {
    const issues: string[] = [];
    const warnings: string[] = [];

    try {
      // Check for the active empty-chat welcome component
      const welcomePath = path.join(__dirname, '../src/lib/components/chat/RegularAgentWelcome.svelte');
      const welcomeExists = await fs.access(welcomePath).then(() => true).catch(() => false);

      if (!welcomeExists) {
        issues.push('RegularAgentWelcome component not found');
      } else {
        const welcomeContent = await fs.readFile(welcomePath, 'utf-8');

        // Check for proper welcome message
        if (!welcomeContent.includes('This agent has full workspace context')) {
          warnings.push('RegularAgentWelcome may not show the expected empty-chat prompt');
        }
      }

      // Check ChatPanel for welcome message logic
      const chatPanelPath = path.join(__dirname, '../src/lib/components/chat/ChatPanel.svelte');
      const chatPanelContent = await fs.readFile(chatPanelPath, 'utf-8');

      if (!chatPanelContent.includes('RegularAgentWelcome')) {
        issues.push('ChatPanel does not handle welcome messages');
      }

    } catch (error) {
      issues.push(`Failed to test welcome message: ${error}`);
    }

    return {
      name: 'Welcome Message',
      passed: issues.length === 0,
      issues,
      warnings,
    };
  }

  /**
   * Run all tests
   */
  async runAllTests(): Promise<void> {
    console.log('\n🧪 Testing Workspace Creation Flow\n');
    console.log('==================================================\n');

    // Run tests
    this.results.push(await this.testWorkspaceCreation());
    this.results.push(await this.testInitialAgentCreation());
    this.results.push(await this.testAgentActivation());
    this.results.push(await this.testMessageSending());
    this.results.push(await this.testStreamingFunctionality());
    this.results.push(await this.testEmptyChatWelcome());

    // Display results
    for (const result of this.results) {
      console.log(`📋 ${result.name}`);
      console.log('   Tests workspace creation and initial agent setup');

      if (result.passed) {
        console.log('   ✅ PASSED');
      } else {
        console.log('   ❌ FAILED');
        for (const issue of result.issues) {
          console.log(`   └─ ${issue}`);
        }
      }

      if (result.warnings && result.warnings.length > 0) {
        for (const warning of result.warnings) {
          logger.warn(`[${result.name}] ${warning}`);
        }
      }

      console.log('');
    }

    // Summary
    console.log('==================================================\n');
    console.log('📊 Test Summary\n');

    const passed = this.results.filter(r => r.passed).length;
    const failed = this.results.filter(r => !r.passed).length;
    const totalWarnings = this.results.reduce((sum, r) => sum + (r.warnings?.length || 0), 0);

    console.log(`Total: ${this.results.length}`);
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    if (totalWarnings > 0) {
      console.log(`Warnings: ${totalWarnings}`);
    }

    console.log('');

    if (failed === 0) {
      console.log('🎉 All workspace creation tests passed!');
    } else {
      console.log('❗ Some workspace creation tests need attention.');
      process.exit(1);
    }
  }
}

// Run tests
const tester = new WorkspaceCreationTest();
tester.runAllTests().catch(error => {
  logger.error('Test execution failed', error);
  process.exit(1);
});
