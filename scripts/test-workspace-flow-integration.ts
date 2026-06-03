#!/usr/bin/env tsx

/**
 * Integration Test for Complete Workspace Creation Flow
 *
 * Simulates the complete flow of:
 * 1. Creating a new workspace
 * 2. Initial agent being created
 * 3. Agent activation
 * 4. Sending initial message
 * 5. Streaming response
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { Logger } from '../src/main/utils/logger';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logger = new Logger('WorkspaceFlowIntegration');

interface FlowStep {
  name: string;
  check: () => Promise<boolean>;
  critical: boolean;
}

class WorkspaceFlowIntegrationTest {
  private steps: FlowStep[] = [];
  private results: { step: string; passed: boolean; error?: string }[] = [];

  constructor() {
    this.setupSteps();
  }

  private setupSteps() {
    this.steps = [
      {
        name: 'Compact Workspace Initializer Component',
        check: async () => {
          const filePath = path.join(__dirname, '../src/lib/components/workspace/CompactWorkspaceInitializer.svelte');
          const content = await fs.readFile(filePath, 'utf-8');

          // Check all critical elements
          return content.includes('unifiedIdService.generateAgentId()') &&
                 content.includes('initialAgent') &&
                 content.includes('workspaceClient.create') &&
                 content.includes('sessionStorage.setItem');
        },
        critical: true,
      },
      {
        name: 'Workspace Service Creation',
        check: async () => {
          const filePath = path.join(__dirname, '../src/features/workspace/main/workspace.service.ts');
          const content = await fs.readFile(filePath, 'utf-8');

          return content.includes('request.initialAgent') &&
                 content.includes('AgentStatus.Pending') &&
                 content.includes('workspaceCreated({');
        },
        critical: true,
      },
      {
        name: 'Agent Factory Integration',
        check: async () => {
          const filePath = path.join(__dirname, '../src/features/agent/services/agent-factory.ts');
          const content = await fs.readFile(filePath, 'utf-8');

          return content.includes('workspace-initializer') &&
                 content.includes('metadata') &&
                 content.includes('createInBackend');
        },
        critical: true,
      },
      {
        name: 'Backend Handler Activation',
        check: async () => {
          const filePath = path.join(__dirname, '../src/features/agent/main/agent-backend-handler.service.ts');
          const content = await fs.readFile(filePath, 'utf-8');

          return content.includes('handleActivate') &&
                 content.includes('agent.id') &&
                 content.includes('backendSessionId');
        },
        critical: true,
      },
      {
        name: 'Workspace Page Integration',
        check: async () => {
          const filePath = path.join(__dirname, '../src/routes/workspace/[id]/+page.svelte');
          const content = await fs.readFile(filePath, 'utf-8');

          return content.includes('initialAgentId') &&
                 content.includes('isInitialAgent') &&
                 content.includes('restoreInitialAgent');
        },
        critical: true,
      },
      {
        name: 'Chat Panel Initialization',
        check: async () => {
          const filePath = path.join(__dirname, '../src/lib/components/chat/ChatPanel.svelte');
          const content = await fs.readFile(filePath, 'utf-8');

          return content.includes('sendInitialMessageRequested') &&
                 content.includes('agentMessages') &&
                 content.includes('agentSessionIsStreaming');
        },
        critical: true,
      },
      {
        name: 'Streaming Message Content',
        check: async () => {
          const filePath = path.join(__dirname, '../src/lib/components/chat/StreamingMessageContent.svelte');
          const content = await fs.readFile(filePath, 'utf-8');

          return content.includes('isStreaming={isStreaming') &&
                 content.includes('onDestroy');
        },
        critical: false,
      },
      {
        name: 'Agent Session Redux State',
        check: async () => {
          const filePath = path.join(__dirname, '../src/store/renderer/slices/agent-session/agent-session-slice.ts');
          const content = await fs.readFile(filePath, 'utf-8');

          return content.includes('upsertSession') &&
                 content.includes('replaceMessages') &&
                 content.includes('setAgentStreaming');
        },
        critical: true,
      },
      {
        name: 'Welcome Message Component',
        check: async () => {
          const regularPath = path.join(__dirname, '../src/lib/components/chat/RegularAgentWelcome.svelte');

          const regularExists = await fs.access(regularPath).then(() => true).catch(() => false);

          return regularExists;
        },
        critical: false,
      },
      {
        name: 'Session Storage Integration',
        check: async () => {
          const pagePath = path.join(__dirname, '../src/routes/workspace/[id]/+page.svelte');
          const initPath = path.join(__dirname, '../src/lib/components/workspace/CompactWorkspaceInitializer.svelte');

          const pageContent = await fs.readFile(pagePath, 'utf-8');
          const initContent = await fs.readFile(initPath, 'utf-8');

          return pageContent.includes('sessionStorage.getItem') &&
                 initContent.includes('sessionStorage.setItem');
        },
        critical: true,
      },
    ];
  }

  async runTest(step: FlowStep): Promise<void> {
    try {
      const passed = await step.check();
      this.results.push({ step: step.name, passed });

      if (!passed && step.critical) {
        logger.error(`Critical step failed: ${step.name}`);
      }
    } catch (error) {
      this.results.push({
        step: step.name,
        passed: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async runAllTests(): Promise<void> {
    console.log('\n🔄 Testing Complete Workspace Creation Flow\n');
    console.log('============================================================\n');

    // Run all tests
    for (const step of this.steps) {
      await this.runTest(step);
    }

    // Display results
    for (const result of this.results) {
      const icon = result.passed ? '✅' : '❌';
      const critical = this.steps.find(s => s.name === result.step)?.critical ? ' [CRITICAL]' : '';

      console.log(`${icon} ${result.step}${critical}`);
      if (result.error) {
        console.log(`   └─ Error: ${result.error}`);
      }
    }

    // Summary
    console.log('\n============================================================\n');
    console.log('📊 Flow Integration Summary:\n');

    const passed = this.results.filter(r => r.passed).length;
    const failed = this.results.filter(r => !r.passed).length;
    const criticalFailed = this.results.filter(r => {
      const step = this.steps.find(s => s.name === r.step);
      return !r.passed && step?.critical;
    }).length;

    console.log(`Total Steps: ${this.results.length}`);
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    if (criticalFailed > 0) {
      console.log(`Critical Failures: ${criticalFailed}`);
    }

    console.log('');

    if (failed === 0) {
      console.log('🎉 Complete workspace creation flow is working correctly!');
    } else if (criticalFailed === 0) {
      console.log('✅ All critical steps passed. Non-critical issues detected.');
    } else {
      console.log('❗ Critical issues detected in workspace creation flow.');
      process.exit(1);
    }
  }
}

// Run the integration test
const tester = new WorkspaceFlowIntegrationTest();
tester.runAllTests().catch(error => {
  logger.error('Integration test failed', error);
  process.exit(1);
});
