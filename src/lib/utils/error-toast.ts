/**
 * Error Toast Utility
 * Shows errors using the built-in toast system
 */
import { toast } from '$lib/components/ui/toast';
import ErrorToast from '$lib/components/ui/toast/ErrorToast.svelte';
import { errorReporter } from '$lib/utils/error-reporter';
import { selectWorkspaceDefaultModel } from '$store/renderer/slices/model/model-selectors';
import { selectCurrentWorkspace } from '$store/renderer/slices/workspace/workspace-selectors';
import { WorkspaceId } from '$shared/types/branded-ids';
import { createAgentTypeId } from '$shared/types/agent.types';
import { createAgentFromConfigRequested } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
import type { AppError } from '$lib/utils/error-handler.svelte';
import { errorHandler } from '$lib/utils/error-handler.svelte';
import { store as appStore } from '$store/renderer/store';
import { m } from '$shared/paraglide/messages.js';
import { formatDateTime } from '$lib/i18n/format';

const APP_NAME = 'Intent'; // i18n-ignore (brand name)

/**
 * Copy error details to clipboard for support
 * (report body is agent/support-facing markdown, kept in English)
 */
async function copyError(error: AppError): Promise<void> {
  const lines = [
    '## 🐛 Error Report', // i18n-ignore (support report content)
    '',
    `**Error:** ${error.title}`,
    `**Message:** ${error.message}`,
    `**Time:** ${formatDateTime(error.timestamp)}`,
    `**ID:** \`${error.id}\``,
    '',
  ];

  if (error.stack) {
    lines.push('<details>');
    lines.push('<summary>Stack Trace</summary>');
    lines.push('');
    lines.push('```');
    lines.push(error.stack.split('\n').slice(0, 15).join('\n'));
    lines.push('```');
    lines.push('</details>');
  }

  lines.push('');
  lines.push('---');
  lines.push('*Paste this into a support message or GitHub issue.*'); // i18n-ignore (support report content)

  await navigator.clipboard.writeText(lines.join('\n'));
  toast.success(m.error_toast_copied_message());
}

/**
 * Send error to an AI agent for debugging
 */
async function sendToAgent(error: AppError): Promise<void> {
  const workspace = selectCurrentWorkspace.select(appStore.state);
  if (!workspace) {
    toast.error(m.error_toast_noSpace_error());
    return;
  }

  const report = errorReporter.generateReport(error, {
    workspaceId: workspace.id,
  });

  // i18n-ignore (agent prompt content)
  const prompt = `I'm using ${APP_NAME} and encountered a bug. Help me figure out what went wrong.

${report.agentPrompt}`;

  const state = appStore.state;
  appStore.dispatch(
    createAgentFromConfigRequested(
      workspace.id,
      {
        name: m.error_toast_debugAgent_name(),
        // Generated placeholder — keep the session self-renameable.
        nameExplicitlySet: false,
        workspaceId: WorkspaceId(workspace.id),
        agentType: createAgentTypeId('debug'),
        initialMessage: prompt,
        model: selectWorkspaceDefaultModel.select(state, workspace.id),
        source: 'error-toast',
        metadata: {
          source: 'error-toast',
          errorId: error.id,
        },
      },
      { openAgent: true },
    ),
  );

  errorHandler.dismiss(error.id);
}

/**
 * Attempt to recover from an error
 */
async function attemptRecovery(error: AppError): Promise<void> {
  const success = await errorHandler.attemptRecovery(error.id);
  if (success) {
    errorHandler.dismiss(error.id);
    toast.success(m.error_recovery_success());
  } else {
    toast.error(m.error_recovery_failed());
  }
}

/**
 * Show an error as a toast notification
 */
export function showErrorToast(error: AppError): void {
  toast.custom(ErrorToast, {
    componentProps: {
      error,
      onCopy: () => copyError(error),
      onDebug: () => sendToAgent(error),
      onRetry: error.recoverable ? () => attemptRecovery(error) : undefined,
    },
    duration: error.type === 'info' ? 5000 : 15000,
  });
}
