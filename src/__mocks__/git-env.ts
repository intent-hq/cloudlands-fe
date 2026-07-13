/**
 * Mock for $shared/git/git-env
 * Used via resolve alias in vitest.config.ts
 */
import { vi } from 'vitest';

export const getGitEnv = vi.fn(() => ({ GIT_TERMINAL_PROMPT: '0' }));
export const gitEnv: NodeJS.ProcessEnv = { GIT_TERMINAL_PROMPT: '0' };
export const buildGitEnv = vi.fn(() => ({ GIT_TERMINAL_PROMPT: '0' }));
export const createGitEnv = vi.fn(() => ({ GIT_TERMINAL_PROMPT: '0' }));
export const createShellEnv = vi.fn(() => ({ ...process.env }));

export const execAsync = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });
export const execFileAsync = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });
export const execAsyncWithGitEnv = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });
export const execFileAsyncWithGitEnv = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });
export const execAsyncWithRetry = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });
export const execFileAsyncWithRetry = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });
export const execAsyncRobust = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });

export const getEnhancedPath = vi.fn(() => process.env.PATH || '');
export const getSSHAuthSock = vi.fn(() => process.env.SSH_AUTH_SOCK || '');
export const getSSHAskPassPath = vi.fn(() => undefined);
export const getConfiguredSshKeyPath = vi.fn(() => undefined);

export const detectKeychainAccessRisk = vi.fn().mockResolvedValue({
  willTriggerKeychain: false,
  credentialHelper: null,
  isHttpsRemote: false,
  remoteUrl: null,
  reason: 'Mock - no keychain access',
});

export const getCredentialHelpers = vi.fn().mockResolvedValue([]);
export const getRemoteUrl = vi.fn().mockResolvedValue(null);
export const isKeychainCredentialHelper = vi.fn(() => false);
export const isGcmCredentialHelper = vi.fn(() => false);
export const isHttpsRemote = vi.fn(() => false);
export const isSSHRemote = vi.fn(() => false);
export const isNetworkOperation = vi.fn(() => false);

export const GIT_NETWORK_OPERATIONS = ['push', 'pull', 'fetch', 'clone', 'ls-remote'] as const;

// Type exports
export interface GitEnvPolicy {
  terminalPrompt?: 'disable' | 'allow' | 'inherit';
  credentialHelper?: 'disable' | 'allow' | 'inherit';
}

export interface ExecOptions {
  cwd?: string;
  maxBuffer?: number;
  timeout?: number;
  encoding?: BufferEncoding;
  env?: NodeJS.ProcessEnv;
  gitPolicy?: GitEnvPolicy;
  shell?: string;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
}

export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
}

export interface KeychainAccessRisk {
  willTriggerKeychain: boolean;
  credentialHelper: string | null;
  isHttpsRemote: boolean;
  remoteUrl: string | null;
  reason: string;
}

export type GitTerminalPromptPolicy = 'disable' | 'allow' | 'inherit';
export type GitCredentialHelperPolicy = 'disable' | 'allow' | 'inherit';
export type GitNetworkOperation = (typeof GIT_NETWORK_OPERATIONS)[number];
