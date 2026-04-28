/**
 * Mock for @pierre/diffs/worker module
 * Avoids lru_map ESM import issues in tests
 */
import { vi } from 'vitest';

export interface WorkerPoolManager {
  highlight: (text: string, language: string) => Promise<unknown>;
  terminate: () => void;
  inspectCaches: () => { fileCache: Map<string, unknown>; diffCache: Map<string, unknown> };
}

export const getOrCreateWorkerPoolSingleton = vi.fn((): WorkerPoolManager => ({
  highlight: vi.fn().mockResolvedValue([]),
  terminate: vi.fn(),
  inspectCaches: vi.fn(() => ({ fileCache: new Map(), diffCache: new Map() })),
}));

export const terminateWorkerPoolSingleton = vi.fn();
