/**
 * IPC handlers for agent testing functionality
 */

import { ipcMain } from 'electron';
import { Logger } from '../../../shared/logger';
import { agentTestingService } from './agent-testing.service';
import { AGENT_TESTING_CHANNELS } from '$shared/ipc/channels';
import { createSafeValidatedHandler } from '../../../main/ipc-validation-middleware';
import {
  AgentTestingRunSchema,
  AgentTestingGetReportSchema,
  AgentTestingGetAgentReportsSchema,
  AgentTestingCleanupSchema,
} from '../../../main/ipc-schemas';

const logger = new Logger('AgentTestingIPC');

export function setupAgentTestingIPC() {
  // Only enable in development mode
  if (process.env.NODE_ENV !== 'development') {
    logger.info('Agent testing disabled in production');
    return;
  }

  logger.info('Setting up agent testing IPC handlers');

  // Run tests for an agent
  ipcMain.handle(
    AGENT_TESTING_CHANNELS.RUN,
    createSafeValidatedHandler(
      AgentTestingRunSchema,
      async (_, validated) => {
        try {
          const result = await agentTestingService.runTests(validated);
          return {
            success: result.ok,
            data: result.ok ? result.data : undefined,
            error: result.ok ? undefined : result.error,
          };
        } catch (error) {
          logger.error('Failed to run agent tests:', error as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to run tests',
          };
        }
      },
      AGENT_TESTING_CHANNELS.RUN,
    ),
  );

  // Get test report
  ipcMain.handle(
    AGENT_TESTING_CHANNELS.GET_REPORT,
    createSafeValidatedHandler(
      AgentTestingGetReportSchema,
      async (_, validated) => {
        try {
          const report = agentTestingService.getReport(validated.requestId);
          return {
            success: true,
            data: report,
          };
        } catch (error) {
          logger.error('Failed to get test report:', error as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to get report',
          };
        }
      },
      AGENT_TESTING_CHANNELS.GET_REPORT,
    ),
  );

  // Get all reports for an agent
  ipcMain.handle(
    AGENT_TESTING_CHANNELS.GET_AGENT_REPORTS,
    createSafeValidatedHandler(
      AgentTestingGetAgentReportsSchema,
      async (_, validated) => {
        try {
          const reports = agentTestingService.getAgentReports(validated.agentId);
          return {
            success: true,
            data: reports,
          };
        } catch (error) {
          logger.error('Failed to get agent reports:', error as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to get reports',
          };
        }
      },
      AGENT_TESTING_CHANNELS.GET_AGENT_REPORTS,
    ),
  );

  // Clean up old reports
  ipcMain.handle(
    AGENT_TESTING_CHANNELS.CLEANUP,
    createSafeValidatedHandler(
      AgentTestingCleanupSchema,
      async (_, validated) => {
        try {
          agentTestingService.cleanupOldReports(validated.daysToKeep);
          return {
            success: true,
          };
        } catch (error) {
          logger.error('Failed to cleanup reports:', error as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to cleanup',
          };
        }
      },
      AGENT_TESTING_CHANNELS.CLEANUP,
    ),
  );

  logger.info('Agent testing IPC handlers registered');
}
