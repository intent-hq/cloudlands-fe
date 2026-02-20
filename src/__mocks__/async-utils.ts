/**
 * Mock for $shared/main/async-utils
 * Used via resolve alias in vitest.config.ts
 */
import { vi } from 'vitest';

export const execAsync = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });
export const execFileAsync = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });
export const writeFileAsync = vi.fn().mockResolvedValue(undefined);
export const readFileAsync = vi.fn().mockResolvedValue('');
export const mkdirAsync = vi.fn().mockResolvedValue(undefined);
export const existsAsync = vi.fn().mockResolvedValue(false);
export const findExecutableAsync = vi.fn().mockResolvedValue(null);
export const findVSCodeAsync = vi.fn().mockResolvedValue(null);
export const findAuggieAsync = vi.fn().mockResolvedValue(null);
export const getNpmGlobalBinAsync = vi.fn().mockResolvedValue(null);
export const writeJsonAsync = vi.fn().mockResolvedValue(undefined);
export const readJsonAsync = vi.fn().mockResolvedValue(null);
export const VSCODE_COMMON_PATHS: string[] = [];
export const AUGGIE_COMMON_PATHS: string[] = [];
