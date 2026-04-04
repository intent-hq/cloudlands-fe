import { toast } from 'svelte-sonner';
import { Logger } from '$shared/logger';

const logger = new Logger('ReversibleActions');

export interface ReversibleAction {
  id: string;
  message: string;
  action: () => Promise<void> | void;
  onUndo?: () => Promise<void> | void;
  onExpire?: () => Promise<void> | void; // Called when undo duration expires without undo
  duration?: number; // Duration in seconds for undo availability
  immediate?: boolean; // If true, execute immediately and allow undo (default: true)
  showCountdown?: boolean; // If true, show countdown before executing (default: false)
}

class ReversibleActionManager {
  private pendingActions = new Map<string, { timeout: NodeJS.Timeout; action: ReversibleAction }>();
  private completedActions = new Map<string, ReversibleAction>();

  /**
   * Execute a reversible action
   * @param config The action configuration
   * @returns Promise that resolves when the action is executed or cancelled
   */
  async execute(config: ReversibleAction): Promise<boolean> {
    const duration = config.duration ?? 15; // Default 15 seconds
    const actionId = config.id || globalThis.crypto.randomUUID();
    const immediate = config.immediate ?? true; // Default to immediate execution
    const showCountdown = config.showCountdown ?? false; // Default to no countdown

    if (immediate && !showCountdown) {
      // Execute immediately and show undo option
      try {
        await config.action();
        this.completedActions.set(actionId, config);

        let undoExecuted = false;

        if (config.onUndo) {
          const toastId = toast.warning(config.message, {
            duration: duration * 1000,
            action: {
              label: 'Undo',
              onClick: async () => {
                try {
                  undoExecuted = true;
                  await config.onUndo!();
                  this.completedActions.delete(actionId);
                  // Just dismiss the toast, don't show a new one
                  toast.dismiss(toastId);
                } catch (error) {
                  logger.error(
                    'Failed to undo action:',
                    error instanceof Error ? error : new Error(String(error)),
                  );
                  toast.error('Failed to undo action');
                }
              },
            },
          });
        } else {
          toast.success(config.message);
        }

        // Clean up completed action after duration and call onExpire if not undone
        setTimeout(async () => {
          if (!undoExecuted && config.onExpire) {
            try {
              await config.onExpire();
            } catch (error) {
              logger.error(
                'Failed to execute onExpire callback:',
                error instanceof Error ? error : new Error(String(error)),
              );
            }
          }
          this.completedActions.delete(actionId);
        }, duration * 1000);

        return true;
      } catch (error) {
        logger.error(
          'Failed to execute action:',
          error instanceof Error ? error : new Error(String(error)),
        );
        toast.error(`Failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        return false;
      }
    } else if (showCountdown) {
      // Schedule action with countdown
      return new Promise((resolve) => {
        let remainingTime = duration;
        // eslint-disable-next-line prefer-const
        let countdownInterval: NodeJS.Timeout;

        const executeAction = async () => {
          clearInterval(countdownInterval);
          this.pendingActions.delete(actionId);

          try {
            await config.action();
            toast.success(`${config.message} - Completed`);
            resolve(true);
          } catch (error) {
            logger.error(
              'Failed to execute action:',
              error instanceof Error ? error : new Error(String(error)),
            );
            toast.error(`Failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
            resolve(false);
          }
        };

        const cancelAction = () => {
          clearTimeout(timeout);
          clearInterval(countdownInterval);
          this.pendingActions.delete(actionId);
          toast.info('Action cancelled');
          resolve(false);
        };

        // Show initial toast with countdown
        const toastId = toast.warning(`${config.message} in ${remainingTime} seconds...`, {
          duration: duration * 1000,
          action: {
            label: 'Cancel',
            onClick: cancelAction,
          },
          onDismiss: cancelAction,
          onAutoClose: executeAction,
        });

        // Update countdown every second
        countdownInterval = setInterval(() => {
          remainingTime--;
          if (remainingTime > 0) {
            toast.warning(`${config.message} in ${remainingTime} seconds...`, {
              id: toastId,
              duration: remainingTime * 1000,
              action: {
                label: 'Cancel',
                onClick: cancelAction,
              },
              onDismiss: cancelAction,
              onAutoClose: executeAction,
            });
          }
        }, 1000);

        // Set timeout for action execution
        const timeout = setTimeout(executeAction, duration * 1000);

        this.pendingActions.set(actionId, { timeout, action: config });
      });
    } else {
      // Not immediate and no countdown: present an explicit Execute option with undo window
      return new Promise((resolve) => {
        const executeNow = async () => {
          clearTimeout(timeout);
          this.pendingActions.delete(actionId);
          try {
            await config.action();
            toast.success(`${config.message} - Completed`);
            resolve(true);
          } catch (error) {
            logger.error(
              'Failed to execute action:',
              error instanceof Error ? error : new Error(String(error)),
            );
            toast.error(`Failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
            resolve(false);
          }
        };

        const cancel = () => {
          clearTimeout(timeout);
          this.pendingActions.delete(actionId);
          toast.info('Action cancelled');
          resolve(false);
        };

        const expire = async () => {
          this.pendingActions.delete(actionId);
          try {
            if (config.onExpire) await config.onExpire();
          } catch (error) {
            logger.error(
              'Failed to execute onExpire callback:',
              error instanceof Error ? error : new Error(String(error)),
            );
          }
          toast.info('Action expired');
          resolve(false);
        };

        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const toastId = toast.info(`${config.message}`, {
          duration: duration * 1000,
          action: { label: 'Execute', onClick: executeNow },
          onDismiss: cancel,
          onAutoClose: executeNow,
        });

        const timeout = setTimeout(expire, duration * 1000);
        this.pendingActions.set(actionId, { timeout, action: config });
      });
    }
  }

  /**
   * Cancel a pending action
   */
  cancel(actionId: string): boolean {
    const pending = this.pendingActions.get(actionId);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingActions.delete(actionId);
      toast.info('Action cancelled');
      return true;
    }
    return false;
  }

  /**
   * Cancel all pending actions
   */
  cancelAll(): void {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for (const [id, { timeout }] of this.pendingActions) {
      clearTimeout(timeout);
    }
    this.pendingActions.clear();
    if (this.pendingActions.size > 0) {
      toast.info('All pending actions cancelled');
    }
  }

  /**
   * Get all pending action IDs
   */
  getPendingActions(): string[] {
    return Array.from(this.pendingActions.keys());
  }
}

// Export singleton instance
export const reversibleActions = new ReversibleActionManager();

// Convenience functions for common actions
export async function deleteWithUndo(
  itemName: string,
  deleteAction: () => Promise<void> | void,
  undoAction?: () => Promise<void> | void,
  options: {
    immediate?: boolean;
    duration?: number;
    showCountdown?: boolean;
    onExpire?: () => Promise<void> | void;
  } = {},
): Promise<boolean> {
  return reversibleActions.execute({
    id: globalThis.crypto.randomUUID(),
    message: `Deleted ${itemName}`,
    action: deleteAction,
    onUndo: undoAction,
    onExpire: options.onExpire,
    immediate: options.immediate ?? true, // Default to immediate
    showCountdown: options.showCountdown ?? false,
    duration: options.duration ?? 15,
  });
}

export async function archiveWithUndo(
  itemName: string,
  archiveAction: () => Promise<void> | void,
  unarchiveAction?: () => Promise<void> | void,
  options: { immediate?: boolean; duration?: number; showCountdown?: boolean } = {},
): Promise<boolean> {
  return reversibleActions.execute({
    id: globalThis.crypto.randomUUID(),
    message: `Archived ${itemName}`,
    action: archiveAction,
    onUndo: unarchiveAction,
    immediate: options.immediate ?? true, // Default to immediate
    showCountdown: options.showCountdown ?? false,
    duration: options.duration ?? 15,
  });
}

export async function confirmAction(
  message: string,
  action: () => Promise<void> | void,
  options: { duration?: number; showCountdown?: boolean } = {},
): Promise<boolean> {
  return reversibleActions.execute({
    id: globalThis.crypto.randomUUID(),
    message,
    action,
    immediate: options.showCountdown ? false : true,
    showCountdown: options.showCountdown ?? false,
    duration: options.duration ?? 15,
  });
}

/**
 * Rename an item with undo support.
 * Shows a toast with the old and new names, with an undo button to revert.
 *
 * @param itemType - Type of item being renamed (e.g., "note", "agent", "file")
 * @param oldName - The previous name
 * @param newName - The new name
 * @param renameAction - Action to perform the rename
 * @param undoAction - Optional action to undo the rename (restore old name)
 * @param options - Additional options
 */
export async function renameWithUndo(
  itemType: string,
  oldName: string,
  newName: string,
  renameAction: () => Promise<void> | void,
  undoAction?: () => Promise<void> | void,
  options: {
    duration?: number;
  } = {},
): Promise<boolean> {
  return reversibleActions.execute({
    id: globalThis.crypto.randomUUID(),
    message: `Renamed ${itemType} to "${newName}"`,
    action: renameAction,
    onUndo: undoAction,
    immediate: true,
    showCountdown: false,
    duration: options.duration ?? 15,
  });
}
