import {
  selectHostExecutionContext,
  selectIsHostMember,
} from '@/store/host-execution/host-execution-selectors';
import { m } from '$shared/paraglide/messages.js';

interface HostExecutionNoticeProps {
  kind?: 'git-policy' | 'repository' | 'ai';
}

export function HostExecutionNotice({ kind = 'git-policy' }: HostExecutionNoticeProps) {
  const member = selectIsHostMember();
  const execution = selectHostExecutionContext();
  const message = !member.value
    ? null
    : kind === 'ai'
      ? m.hostExecution_providerSetup_description()
      : kind === 'repository'
        ? execution.value && !execution.value.repositoryConnections.some((row) => row.configured)
          ? m.hostExecution_repositorySetup_description()
          : null
        : execution.value?.gitCredentialPolicy.managedHelperEnabled === false
          ? m.hostExecution_disabledHelper_description({
              setting: execution.value.gitCredentialPolicy.setting,
            })
          : null;

  return message ? (
    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Preserve the source status paragraph and its block layout.
    <p className="type-caption text-muted-foreground px-2 py-1" role="status">
      {message}
    </p>
  ) : null;
}
