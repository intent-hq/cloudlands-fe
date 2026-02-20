/**
 * Git Error Handler
 *
 * Utility for detecting and handling git authentication errors gracefully.
 * When git operations fail due to authentication issues, this emits events
 * that the renderer can use to show user-friendly notifications.
 *
 * Note: Git push/pull operations require local git credentials (SSH keys or
 * credential manager). GitHub API operations (creating PRs, listing repos)
 * go through Augment's backend and don't need local credentials.
 */

import { Logger } from '../logger';

const logger = new Logger('GitErrorHandler');

/**
 * Common patterns that indicate a git authentication error
 */
const AUTH_ERROR_PATTERNS = [
  /fatal: Authentication failed/i,
  /fatal: could not read Username/i,
  /fatal: could not read Password/i,
  /remote: Invalid username or password/i,
  /Permission denied \(publickey\)/i,
  /Host key verification failed/i,
  /fatal: repository .* not found/i,
  /error: unable to access/i,
  /SSL certificate problem/i,
  /The requested URL returned error: 401/i,
  /The requested URL returned error: 403/i,
  /terminal prompts disabled/i,
];

const KEYCHAIN_CANCEL_PATTERNS = [
  /user interaction is not allowed/i,
  /keychain is locked/i,
  /the user name or passphrase you entered is not correct/i,
  /seckeychainunlock/i,
  /seckeychainsearchcopynext/i,
  /errsecinteractionnotallowed/i,
  /errsecusercanceled/i,
  /osstatus -25308/i,
  /osstatus -25293/i,
  /osstatus -128/i,
  /\berrsecusercancelled\b/i,
  /\berrsecusercanceled\b/i,
  /user canceled/i,
  /user cancelled/i,
];

/**
 * Check if an error message indicates an SSH key authentication issue
 */
export function isSSHAuthError(errorOutput: string): boolean {
  return (
    /Permission denied \(publickey\)/i.test(errorOutput) ||
    /Host key verification failed/i.test(errorOutput)
  );
}

/**
 * Check if an error message indicates an HTTPS credential issue
 */
export function isHTTPSAuthError(errorOutput: string): boolean {
  return (
    /fatal: Authentication failed/i.test(errorOutput) ||
    /fatal: could not read Username/i.test(errorOutput) ||
    /fatal: could not read Password/i.test(errorOutput) ||
    /terminal prompts disabled/i.test(errorOutput) ||
    /The requested URL returned error: 40[13]/i.test(errorOutput)
  );
}

/**
 * Check if an error message indicates a git authentication issue
 */
export function isGitAuthError(errorOutput: string): boolean {
  return AUTH_ERROR_PATTERNS.some((pattern) => pattern.test(errorOutput));
}

/**
 * Check if an error message indicates macOS keychain access was cancelled or denied.
 */
export function isKeychainAccessCancelled(errorOutput: string): boolean {
  return KEYCHAIN_CANCEL_PATTERNS.some((pattern) => pattern.test(errorOutput));
}

/**
 * Determine the type of authentication error for better guidance
 */
export type GitAuthErrorType = 'ssh' | 'https' | 'unknown';

export function getGitAuthErrorType(errorOutput: string): GitAuthErrorType {
  if (isSSHAuthError(errorOutput)) return 'ssh';
  if (isHTTPSAuthError(errorOutput)) return 'https';
  return 'unknown';
}

/**
 * Extract a user-friendly message from a git error
 */
export function getGitAuthErrorMessage(errorOutput: string, operation: string): string {
  const errorType = getGitAuthErrorType(errorOutput);

  if (errorType === 'ssh') {
    return `Git ${operation} failed: SSH key not configured. Set up SSH keys or switch to HTTPS with a credential manager.`;
  }

  if (/fatal: repository .* not found/i.test(errorOutput)) {
    return `Git ${operation} failed: Repository not found or you don't have access. Check your permissions.`;
  }

  if (errorType === 'https') {
    return `Git ${operation} failed: Git credentials not configured. Set up a credential manager or use SSH keys.`;
  }

  return `Git ${operation} failed: Git credentials required. Configure SSH keys or a credential manager.`;
}

/**
 * Get detailed setup instructions based on error type
 */
export function getGitCredentialSetupInstructions(errorType: GitAuthErrorType): {
  title: string;
  description: string;
  steps: string[];
} {
  if (errorType === 'ssh') {
    return {
      title: 'SSH Key Setup Required',
      description:
        'Git is using SSH but no SSH key is configured. You can either set up SSH keys or switch to HTTPS.',
      steps: [
        'Generate an SSH key: ssh-keygen -t ed25519 -C "your_email@example.com"',
        'Start the SSH agent: eval "$(ssh-agent -s)"',
        'Add your key: ssh-add ~/.ssh/id_ed25519',
        'Add the public key to GitHub: Settings → SSH and GPG keys → New SSH key',
        'Paste the contents of ~/.ssh/id_ed25519.pub',
      ],
    };
  }

  return {
    title: 'Git Credentials Required',
    description:
      'Git needs credentials to push and pull from this repository. Set up one of the following:',
    steps: [
      'Option 1: Use Git Credential Manager (recommended for HTTPS)',
      '  - macOS: brew install git-credential-manager',
      '  - Run: git credential-manager configure',
      '  - Next push will prompt for GitHub login',
      '',
      'Option 2: Use SSH keys (recommended for security)',
      '  - Generate key: ssh-keygen -t ed25519',
      '  - Add to GitHub: Settings → SSH and GPG keys',
      '  - Change remote: git remote set-url origin git@github.com:OWNER/REPO.git',
    ],
  };
}

/**
 * Result type for git operations that may fail due to auth
 */
export interface GitOperationResult<T> {
  success: boolean;
  data?: T;
  authRequired?: boolean;
  error?: string;
}

/**
 * Wrap a git operation with auth error detection
 * If the operation fails due to auth, returns a structured result
 * instead of throwing.
 */
export async function withGitAuthHandling<T>(
  operation: string,
  fn: () => Promise<T>,
  onAuthRequired?: (message: string) => void,
): Promise<GitOperationResult<T>> {
  try {
    const data = await fn();
    return { success: true, data };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const stderr = (error as any)?.stderr || errorMessage;

    if (isGitAuthError(stderr) || isGitAuthError(errorMessage)) {
      const userMessage = getGitAuthErrorMessage(stderr || errorMessage, operation);
      logger.warn('Git operation requires authentication', { operation, error: errorMessage });

      if (onAuthRequired) {
        onAuthRequired(userMessage);
      }

      return {
        success: false,
        authRequired: true,
        error: userMessage,
      };
    }

    // Re-throw non-auth errors
    throw error;
  }
}
