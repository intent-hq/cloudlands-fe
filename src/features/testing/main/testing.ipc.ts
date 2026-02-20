/**
 * Testing IPC Handlers
 *
 * Provides IPC endpoints for agent testing capabilities.
 * All handlers use validated input schemas for type safety.
 */

import { ipcMain } from 'electron';
import { testingService } from '../testing.service';
import { TESTING_CHANNELS } from '../../../shared/ipc/channels';
import { createSafeValidatedHandler } from '../../../main/ipc-validation-middleware';
import {
  TestingRunTestsSchema,
  TestingRunLintSchema,
  TestingRunBuildSchema,
  TestingStopProcessSchema,
  TestingGetProcessesSchema,
} from '../../../main/ipc-schemas';

export function setupTestingIPC() {
  // Run tests
  ipcMain.handle(
    TESTING_CHANNELS.RUN_TESTS,
    createSafeValidatedHandler(
      TestingRunTestsSchema,
      async (_event, validated: any) =>
        // The validated object has the correct shape from our schema
        testingService.runTests({
          workspaceId: validated.workspaceId,
          testFiles: validated.testFiles,
          testPattern: validated.testPattern,
          coverage: validated.coverage,
          watch: validated.watch,
          timeout: validated.timeout,
        }),
      TESTING_CHANNELS.RUN_TESTS,
    ),
  );

  // Run linting
  ipcMain.handle(
    TESTING_CHANNELS.RUN_LINT,
    createSafeValidatedHandler(
      TestingRunLintSchema,
      async (_event, validated: any) =>
        testingService.runLint({
          workspaceId: validated.workspaceId,
          files: validated.files,
          fix: validated.fix,
        }),
      TESTING_CHANNELS.RUN_LINT,
    ),
  );

  // Run build
  ipcMain.handle(
    TESTING_CHANNELS.RUN_BUILD,
    createSafeValidatedHandler(
      TestingRunBuildSchema,
      async (_event, validated: any) =>
        testingService.runBuild({
          workspaceId: validated.workspaceId,
          watch: validated.watch,
          production: validated.production,
        }),
      TESTING_CHANNELS.RUN_BUILD,
    ),
  );

  // Stop a running process
  ipcMain.handle(
    TESTING_CHANNELS.STOP_PROCESS,
    createSafeValidatedHandler(
      TestingStopProcessSchema,
      async (_event, validated: any) => testingService.stopProcess(validated.processId),
      TESTING_CHANNELS.STOP_PROCESS,
    ),
  );

  // Get running processes
  ipcMain.handle(
    TESTING_CHANNELS.GET_PROCESSES,
    createSafeValidatedHandler(
      TestingGetProcessesSchema,
      async () => ({
        success: true,
        data: testingService.getRunningProcesses(),
      }),
      TESTING_CHANNELS.GET_PROCESSES,
    ),
  );
}
