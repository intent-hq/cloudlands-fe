import { WorkspaceStatusEnum, type Workspace, type AttentionReminderReason } from '$shared/types';

type WorkspaceReminderInput = Pick<Workspace, 'displayStatus' | 'attentionReminder' | 'activity'>;

/** Raw failures and blockers remain visible regardless of acknowledgement. */
export function workspaceReminderStatus(workspace: WorkspaceReminderInput) {
  if (workspace.displayStatus === 'blocked' || workspace.displayStatus === 'failed')
    return workspace.displayStatus;
  if (workspace.displayStatus === 'needs_attention' && workspace.attentionReminder?.dismissed) {
    if (workspace.activity === 'agent_running') return 'in_progress';
    if (workspace.activity === 'idle') return 'waiting';
    return workspace.attentionReminder.displayStatus;
  }
  return workspace.displayStatus ?? workspace.attentionReminder?.displayStatus;
}

/** Late replies must preserve newer reasons and acknowledgements. */
export function applyWorkspaceReminderAcknowledgement(
  workspace: Workspace,
  response: Workspace,
  requestedReminder: Workspace['attentionReminder'],
): Workspace {
  const current = workspace.attentionReminder;
  const superseded =
    current !== requestedReminder &&
    (!current ||
      !requestedReminder ||
      current.dismissed !== requestedReminder.dismissed ||
      current.displayStatus !== requestedReminder.displayStatus ||
      current.reasons.length !== requestedReminder.reasons.length ||
      current.reasons.some(
        (reason) =>
          !requestedReminder.reasons.some(
            (pair) => pair.id === reason.id && pair.revision === reason.revision,
          ),
      ));
  if (superseded) return workspace;
  return {
    ...workspace,
    attentionReminder: response.attentionReminder ?? current,
  };
}

export function workspaceReminderDismissed(workspace: WorkspaceReminderInput): boolean {
  return workspace.attentionReminder?.dismissed === true;
}

/** Capture a plain snapshot when a menu opens, never at action time. */
export function dismissibleWorkspaceReasons(workspace: Workspace): AttentionReminderReason[] {
  if (
    workspace.status === WorkspaceStatusEnum.Archived ||
    workspace.status === WorkspaceStatusEnum.Deleted ||
    workspace.pendingDeleteAt
  )
    return [];
  const reminder = workspace.attentionReminder;
  const status = workspaceReminderStatus(workspace);
  if (!reminder || reminder.dismissed || status === 'failed' || status === 'blocked') return [];
  return reminder.reasons.map(({ id, revision }) => ({ id, revision }));
}
