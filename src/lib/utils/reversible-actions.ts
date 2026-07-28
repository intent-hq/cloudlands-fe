import { toast } from 'svelte-sonner';
import { Logger } from '$shared/logger';
import { m } from '$shared/paraglide/messages.js';

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

        const onUndo = config.onUndo;
        if (onUndo) {
          const toastId = toast.warning(config.message, {
            duration: duration * 1000,
            action: {
              label: m.ui_reversibleActions_undo_label(),
              onClick: async () => {
                try {
                  undoExecuted = true;
                  await onUndo();
                  this.completedActions.delete(actionId);
                  // Just dismiss the toast, don't show a new one
                  toast.dismiss(toastId);
                } catch (error) {
                  logger.error(
                    // i18n-ignore (developer log message)
                    'Failed to undo action:',
                    error instanceof Error ? error : new Error(String(error)),
                  );
                  toast.error(m.ui_reversibleActions_undoFailed_error());
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
                // i18n-ignore (developer log message)
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
          // i18n-ignore (developer log message)
          'Failed to execute action:',
          error instanceof Error ? error : new Error(String(error)),
        );
        toast.error(
          m.ui_reversibleActions_failed_error({
            message:
              error instanceof Error ? error.message : m.ui_reversibleActions_unknownError_label(),
          }),
        );
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
            toast.success(m.ui_reversibleActions_completed_message({ message: config.message }));
            resolve(true);
          } catch (error) {
            logger.error(
              // i18n-ignore (developer log message)
              'Failed to execute action:',
              error instanceof Error ? error : new Error(String(error)),
            );
            toast.error(
              m.ui_reversibleActions_failed_error({
                message:
                  error instanceof Error
                    ? error.message
                    : m.ui_reversibleActions_unknownError_label(),
              }),
            );
            resolve(false);
          }
        };

        const cancelAction = () => {
          clearTimeout(timeout);
          clearInterval(countdownInterval);
          this.pendingActions.delete(actionId);
          toast.info(m.ui_reversibleActions_cancelled_message());
          resolve(false);
        };

        // Show initial toast with countdown
        const toastId = toast.warning(
          m.ui_reversibleActions_countdown_message({
            message: config.message,
            seconds: remainingTime,
          }),
          {
            duration: duration * 1000,
            action: {
              label: m.ui_reversibleActions_cancel_label(),
              onClick: cancelAction,
            },
            onDismiss: cancelAction,
            onAutoClose: executeAction,
          },
        );

        // Update countdown every second
        countdownInterval = setInterval(() => {
          remainingTime--;
          if (remainingTime > 0) {
            toast.warning(
              m.ui_reversibleActions_countdown_message({
                message: config.message,
                seconds: remainingTime,
              }),
              {
                id: toastId,
                duration: remainingTime * 1000,
                action: {
                  label: m.ui_reversibleActions_cancel_label(),
                  onClick: cancelAction,
                },
                onDismiss: cancelAction,
                onAutoClose: executeAction,
              },
            );
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
            toast.success(m.ui_reversibleActions_completed_message({ message: config.message }));
            resolve(true);
          } catch (error) {
            logger.error(
              // i18n-ignore (developer log message)
              'Failed to execute action:',
              error instanceof Error ? error : new Error(String(error)),
            );
            toast.error(
              m.ui_reversibleActions_failed_error({
                message:
                  error instanceof Error
                    ? error.message
                    : m.ui_reversibleActions_unknownError_label(),
              }),
            );
            resolve(false);
          }
        };

        const cancel = () => {
          clearTimeout(timeout);
          this.pendingActions.delete(actionId);
          toast.info(m.ui_reversibleActions_cancelled_message());
          resolve(false);
        };

        const expire = async () => {
          this.pendingActions.delete(actionId);
          try {
            if (config.onExpire) await config.onExpire();
          } catch (error) {
            logger.error(
              // i18n-ignore (developer log message)
              'Failed to execute onExpire callback:',
              error instanceof Error ? error : new Error(String(error)),
            );
          }
          toast.info(m.ui_reversibleActions_expired_message());
          resolve(false);
        };

        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const toastId = toast.info(`${config.message}`, {
          duration: duration * 1000,
          action: { label: m.ui_reversibleActions_execute_label(), onClick: executeNow },
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
      toast.info(m.ui_reversibleActions_cancelled_message());
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
      toast.info(m.ui_reversibleActions_allCancelled_message());
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
    message: m.ui_reversibleActions_deleted_message({ itemName }),
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
    message: m.ui_reversibleActions_archived_message({ itemName }),
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
    message: m.ui_reversibleActions_renamed_message({ itemType, newName }),
    action: renameAction,
    onUndo: undoAction,
    immediate: true,
    showCountdown: false,
    duration: options.duration ?? 15,
  });
}
