/**
 * MCP Tools for Agent Testing
 *
 * Provides testing tools that AI agents can use through the MCP protocol.
 */

import { z } from 'zod';
import { Logger } from '../../shared/logger';
import { agentTestingService } from './main/agent-testing.service';

const logger = new Logger('TestingTools');

// Tool schemas
export const TestIPCSchema = z.object({
  workspaceId: z.string(),
  channel: z.string(),
  input: z.any(),
  expectedOutput: z.any().optional(),
  expectedError: z.string().optional(),
  timeout: z.number().optional(),
  description: z.string().optional(),
});

export const TestComponentSchema = z.object({
  workspaceId: z.string(),
  componentPath: z.string(),
  props: z.record(z.any()).optional(),
  actions: z
    .array(
      z.object({
        type: z.enum(['click', 'type', 'select', 'hover', 'focus', 'blur', 'scroll']),
        selector: z.string(),
        value: z.any().optional(),
        delay: z.number().optional(),
      }),
    )
    .optional(),
  assertions: z
    .array(
      z.object({
        type: z.enum(['exists', 'visible', 'text', 'value', 'class', 'attribute', 'count']),
        selector: z.string(),
        expected: z.any().optional(),
        not: z.boolean().optional(),
      }),
    )
    .optional(),
  description: z.string().optional(),
});

export const TestIntegrationSchema = z.object({
  workspaceId: z.string(),
  scenario: z.object({
    name: z.string(),
    description: z.string().optional(),
    setup: z
      .object({
        mockData: z.record(z.any()).optional(),
        mockHandlers: z
          .array(
            z.object({
              channel: z.string(),
              response: z.any(),
            }),
          )
          .optional(),
        environment: z.record(z.string()).optional(),
        startServices: z.array(z.string()).optional(),
      })
      .optional(),
    steps: z.array(
      z.object({
        type: z.enum(['ipc', 'component', 'api', 'wait', 'assertion', 'script']),
        name: z.string(),
        config: z.any(),
        continueOnFailure: z.boolean().optional(),
      }),
    ),
    teardown: z
      .object({
        stopServices: z.array(z.string()).optional(),
        cleanupData: z.boolean().optional(),
        restoreHandlers: z.boolean().optional(),
      })
      .optional(),
    timeout: z.number().optional(),
  }),
});

export const RunTestSuiteSchema = z.object({
  workspaceId: z.string(),
  suite: z.enum(['unit', 'integration', 'e2e', 'all']),
  pattern: z.string().optional(),
  coverage: z.boolean().optional(),
  watch: z.boolean().optional(),
});

export const GetTestReportSchema = z.object({
  requestId: z.string().optional(),
  agentId: z.string().optional(),
  latest: z.boolean().optional(),
});

/**
 * Test IPC communication
 */
export async function testIPC(args: z.infer<typeof TestIPCSchema>) {
  const { workspaceId, ...testCase } = args;

  logger.info(`Testing IPC channel: ${testCase.channel}`);

  const result = await agentTestingService.runTests({
    type: 'ipc',
    workspaceId,
    agentId: 'mcp-agent',
    tests: [testCase],
  });

  if (!result.ok) {
    throw new Error(result.error);
  }

  return {
    success: result.data?.summary.passed === 1,
    result: result.data?.results[0],
    suggestions: result.data?.suggestions,
  };
}

/**
 * Test a Svelte component
 */
export async function testComponent(args: z.infer<typeof TestComponentSchema>) {
  const { workspaceId, ...testCase } = args;

  logger.info(`Testing component: ${testCase.componentPath}`);

  const result = await agentTestingService.runTests({
    type: 'component',
    workspaceId,
    agentId: 'mcp-agent',
    tests: [testCase],
  });

  if (!result.ok) {
    throw new Error(result.error);
  }

  return {
    success: result.data?.summary.passed === 1,
    result: result.data?.results[0],
    suggestions: result.data?.suggestions,
  };
}

/**
 * Run an integration test scenario
 */
export async function testIntegration(args: z.infer<typeof TestIntegrationSchema>) {
  const { workspaceId, scenario } = args;

  logger.info(`Running integration test: ${scenario.name}`);

  const result = await agentTestingService.runTests({
    type: 'integration',
    workspaceId,
    agentId: 'mcp-agent',
    tests: [scenario],
  });

  if (!result.ok) {
    throw new Error(result.error);
  }

  return {
    success: result.data?.summary.passed === 1,
    scenario: scenario.name,
    steps: result.data?.results[0]?.steps,
    duration: result.data?.results[0]?.totalDuration,
    suggestions: result.data?.suggestions,
  };
}

/**
 * Run a test suite
 */
export async function runTestSuite(args: z.infer<typeof RunTestSuiteSchema>) {
  const { workspaceId, suite, pattern: _pattern, coverage, watch: _watch } = args;

  logger.info(`Running ${suite} test suite`);

  let testType: 'unit' | 'e2e' | 'integration';

  switch (suite) {
    case 'unit':
      testType = 'unit';
      break;
    case 'e2e':
      testType = 'e2e';
      break;
    case 'integration':
      testType = 'integration';
      break;
    case 'all':
      // Run all test types
      const results = [];
      for (const type of ['unit', 'integration', 'e2e'] as const) {
        const result = await agentTestingService.runTests({
          type,
          workspaceId,
          agentId: 'mcp-agent',
          tests: [],
          options: {
            coverage,
          },
        });

        if (result.ok) {
          results.push(result.data);
        }
      }

      return {
        success: results.every((r) => r?.summary.failed === 0),
        suites: results,
      };
    default:
      throw new Error(`Unknown test suite: ${suite}`);
  }

  const result = await agentTestingService.runTests({
    type: testType,
    workspaceId,
    agentId: 'mcp-agent',
    tests: [],
    options: {
      coverage,
    },
  });

  if (!result.ok) {
    throw new Error(result.error);
  }

  return {
    success: result.data?.summary.failed === 0,
    summary: result.data?.summary,
    coverage: result.data?.coverage,
    suggestions: result.data?.suggestions,
  };
}

/**
 * Get test report
 */
export async function getTestReport(args: z.infer<typeof GetTestReportSchema>) {
  const { requestId, agentId, latest } = args;

  if (requestId) {
    const report = agentTestingService.getReport(requestId);
    return report || { error: 'Report not found' };
  }

  if (agentId) {
    const reports = agentTestingService.getAgentReports(agentId);

    if (latest && reports.length > 0) {
      // Return the most recent report
      return reports.sort((a, b) => b.timestamp - a.timestamp)[0];
    }

    return reports;
  }

  return { error: 'Must provide either requestId or agentId' };
}

/**
 * Register testing tools with MCP
 */
export function registerTestingTools() {
  return {
    'testing.ipc': {
      description: 'Test IPC communication between frontend and backend',
      inputSchema: TestIPCSchema,
      handler: testIPC,
    },
    'testing.component': {
      description: 'Test a Svelte component with actions and assertions',
      inputSchema: TestComponentSchema,
      handler: testComponent,
    },
    'testing.integration': {
      description: 'Run an integration test scenario',
      inputSchema: TestIntegrationSchema,
      handler: testIntegration,
    },
    'testing.suite': {
      description: 'Run a test suite (unit, integration, e2e, or all)',
      inputSchema: RunTestSuiteSchema,
      handler: runTestSuite,
    },
    'testing.report': {
      description: 'Get test report(s)',
      inputSchema: GetTestReportSchema,
      handler: getTestReport,
    },
  };
}
