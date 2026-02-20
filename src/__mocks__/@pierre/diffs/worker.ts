/**
 * Mock for @pierre/diffs/worker module
 * Avoids lru_map ESM import issues in tests
 */
import { vi } from 'vitest';

export interface WorkerPoolManager {
  highlight: (text: string, language: string) => Promise<unknown>;
  terminate: () => void;
}

export const getOrCreateWorkerPoolSingleton = vi.fn((): WorkerPoolManager => ({
  highlight: vi.fn().mockResolvedValue([]),
  terminate: vi.fn(),
}));

export const terminateWorkerPoolSingleton = vi.fn();
