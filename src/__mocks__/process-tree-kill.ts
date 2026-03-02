/**
 * Mock for $shared/main/process-tree-kill
 * Used via resolve alias in vitest.config.ts
 */
import { vi } from 'vitest';

export const killProcessTree = vi.fn().mockResolvedValue(undefined);
export const killChildProcessTree = vi.fn().mockResolvedValue(undefined);
