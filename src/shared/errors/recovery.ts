/**
 * Error Recovery Suggestions
 *
 * Provides actionable recovery suggestions for different error scenarios
 */

export interface RecoverySuggestion {
  action: string;
  description: string;
  automatic?: boolean;
  priority?: 'high' | 'medium' | 'low';
}

export interface RecoveryHint {
  code: string;
  suggestions: RecoverySuggestion[];
  helpLink?: string;
}

/**
 * Recovery suggestions for each error code
 */
export const RECOVERY_SUGGESTIONS: Record<string, RecoverySuggestion[]> = {
  AGENT_CREATION_FAILED: [
    {
      action: 'retry',
      description: 'Try creating the agent again',
      automatic: false,
      priority: 'high',
    },
    {
      action: 'check-config',
      description: 'Verify agent configuration in settings',
      automatic: false,
      priority: 'high',
    },
    {
      action: 'check-resources',
      description: 'Ensure sufficient memory and disk space',
      automatic: false,
      priority: 'medium',
    },
  ],
  AGENT_ALREADY_EXISTS: [
    {
      action: 'rename',
      description: 'Choose a different name for the agent',
      automatic: false,
      priority: 'high',
    },
    {
      action: 'delete-existing',
      description: 'Delete the existing agent first',
      automatic: false,
      priority: 'medium',
    },
  ],
  INVALID_AGENT_CONFIG: [
    {
      action: 'review-config',
      description: 'Review and correct the configuration',
      automatic: false,
      priority: 'high',
    },
    {
      action: 'use-defaults',
      description: 'Reset to default configuration',
      automatic: false,
      priority: 'medium',
    },
  ],
  INVALID_CONFIG: [
    {
      action: 'review-config',
      description: 'Review and correct the configuration',
      automatic: false,
      priority: 'high',
    },
    {
      action: 'use-defaults',
      description: 'Reset to default configuration',
      automatic: false,
      priority: 'medium',
    },
  ],
  SESSION_NOT_FOUND: [
    {
      action: 'start-new',
      description: 'Start a new agent session',
      automatic: false,
      priority: 'high',
    },
    {
      action: 'check-history',
      description: 'Check session history for recent sessions',
      automatic: false,
      priority: 'medium',
    },
  ],
  SESSION_ALREADY_ACTIVE: [
    {
      action: 'wait',
      description: 'Wait for the current session to complete',
      automatic: false,
      priority: 'high',
    },
    {
      action: 'cancel',
      description: 'Cancel the active session first',
      automatic: false,
      priority: 'high',
    },
  ],
  SESSION_INITIALIZATION_FAILED: [
    {
      action: 'retry',
      description: 'Try initializing the session again',
      automatic: false,
      priority: 'high',
    },
    {
      action: 'check-resources',
      description: 'Ensure sufficient resources are available',
      automatic: false,
      priority: 'medium',
    },
  ],
  MESSAGE_SEND_FAILED: [
    {
      action: 'retry',
      description: 'Try sending the message again',
      automatic: false,
      priority: 'high',
    },
    {
      action: 'check-connection',
      description: 'Check your network connection',
      automatic: false,
      priority: 'high',
    },
  ],
  MESSAGE_VALIDATION_FAILED: [
    {
      action: 'review-config',
      description: 'Review and correct the message format',
      automatic: false,
      priority: 'high',
    },
    {
      action: 'check-config',
      description: 'Check configuration for valid message format',
      automatic: false,
      priority: 'medium',
    },
  ],
  MESSAGE_TOO_LONG: [
    {
      action: 'retry',
      description: 'Shorten the message and try again',
      automatic: false,
      priority: 'high',
    },
    {
      action: 'batch',
      description: 'Split the message into multiple parts',
      automatic: false,
      priority: 'medium',
    },
  ],
  PROVIDER_NOT_FOUND: [
    {
      action: 'check-config',
      description: 'Verify provider is properly configured',
      automatic: false,
      priority: 'high',
    },
    {
      action: 'recreate',
      description: 'Install or reinstall the provider',
      automatic: false,
      priority: 'high',
    },
  ],
  PROVIDER_CONNECTION_FAILED: [
    {
      action: 'retry',
      description: 'Try connecting to the provider again',
      automatic: false,
      priority: 'high',
    },
    {
      action: 'check-config',
      description: 'Verify provider configuration',
      automatic: false,
      priority: 'high',
    },
  ],
  STORAGE_READ_FAILED: [
    {
      action: 'retry',
      description: 'Try reading the data again',
      automatic: false,
      priority: 'high',
    },
    {
      action: 'restore',
      description: 'Restore from a recent backup',
      automatic: false,
      priority: 'medium',
    },
  ],
  STORAGE_WRITE_FAILED: [
    {
      action: 'retry',
      description: 'Try saving again',
      automatic: false,
      priority: 'high',
    },
    {
      action: 'check-resources',
      description: 'Check available disk space',
      automatic: false,
      priority: 'high',
    },
  ],
  STREAM_CONNECTION_FAILED: [
    {
      action: 'retry',
      description: 'Try connecting again',
      automatic: false,
      priority: 'high',
    },
    {
      action: 'check-connection',
      description: 'Check your network connection',
      automatic: false,
      priority: 'high',
    },
  ],
  STREAM_RECOVERY_FAILED: [
    {
      action: 'restart',
      description: 'Restart the agent',
      automatic: false,
      priority: 'high',
    },
    {
      action: 'check-config',
      description: 'Check error logs for more details',
      automatic: false,
      priority: 'medium',
    },
  ],
  STREAM_INTERRUPTED: [
    {
      action: 'reconnect',
      description: 'Attempting automatic reconnection',
      automatic: true,
      priority: 'high',
    },
    {
      action: 'retry',
      description: 'Retry sending the message',
      automatic: false,
      priority: 'high',
    },
    {
      action: 'check-connection',
      description: 'Check your internet connection',
      automatic: false,
      priority: 'medium',
    },
  ],
  STREAM_TIMEOUT: [
    {
      action: 'wait',
      description: 'Wait for agent to complete processing',
      automatic: false,
      priority: 'high',
    },
    {
      action: 'cancel',
      description: 'Cancel current operation',
      automatic: false,
      priority: 'medium',
    },
    {
      action: 'increase-timeout',
      description: 'Increase timeout in settings',
      automatic: false,
      priority: 'low',
    },
  ],
  PROVIDER_PROCESS_DIED: [
    {
      action: 'restart',
      description: 'Restart agent process',
      automatic: true,
      priority: 'high',
    },
    {
      action: 'recreate',
      description: 'Create new agent session',
      automatic: false,
      priority: 'high',
    },
  ],
  STORAGE_CORRUPTED: [
    {
      action: 'restore',
      description: 'Restore from backup',
      automatic: false,
      priority: 'high',
    },
    {
      action: 'reset',
      description: 'Reset agent data',
      automatic: false,
      priority: 'medium',
    },
  ],
  MEMORY_LIMIT_EXCEEDED: [
    {
      action: 'cleanup',
      description: 'Close unused agents',
      automatic: false,
      priority: 'high',
    },
    {
      action: 'increase-limit',
      description: 'Increase memory limit in settings',
      automatic: false,
      priority: 'medium',
    },
  ],
  RATE_LIMIT_EXCEEDED: [
    {
      action: 'wait',
      description: 'Wait before making more requests',
      automatic: false,
      priority: 'high',
    },
    {
      action: 'batch',
      description: 'Batch requests together',
      automatic: false,
      priority: 'medium',
    },
  ],
  CONCURRENT_LIMIT_EXCEEDED: [
    {
      action: 'close-agents',
      description: 'Close some running agents',
      automatic: false,
      priority: 'high',
    },
    {
      action: 'queue',
      description: 'Queue operation for later',
      automatic: false,
      priority: 'medium',
    },
  ],
};

/**
 * Get recovery suggestions for an error code
 */
export function getRecoverySuggestions(code: string): RecoverySuggestion[] {
  return (
    RECOVERY_SUGGESTIONS[code] || [
      {
        action: 'retry',
        description: 'Try the operation again',
        automatic: false,
        priority: 'high',
      },
    ]
  );
}

/**
 * Get recovery hints including suggestions and help link
 */
export function getRecoveryHints(code: string, helpLink?: string): RecoveryHint {
  return {
    code,
    suggestions: getRecoverySuggestions(code),
    helpLink,
  };
}
