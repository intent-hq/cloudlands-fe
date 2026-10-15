import { useRef } from 'react';
import { InlinePermissionRequest } from '@/features/chat/components/inline-permission-request';
import { selectConversationPermissionRequests } from '@/store/permission/permission-selectors';

export function WorkspaceConversationPermissions({
  workspaceId,
  agentId,
}: {
  workspaceId: string;
  agentId: string;
}) {
  const requests = selectConversationPermissionRequests(workspaceId, agentId);
  const ref = useRef<HTMLDivElement>(null);
  const request = requests.value[0];
  if (!request) return null;
  return (
    <div ref={ref} data-testid="conversation-permissions">
      <InlinePermissionRequest
        key={request.requestId}
        request={request}
        pendingCount={requests.value.length}
        keyboardShortcutsEnabled
        keyboardShortcutScope={ref}
      />
    </div>
  );
}
