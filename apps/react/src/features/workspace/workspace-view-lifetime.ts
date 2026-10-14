import { useLayoutEffect, useRef } from 'react';
import { store } from '@/store';
import { selectCurrentConnectionId } from '@/store/connections/connections-selectors';
import {
  selectPrincipalSnapshot,
  selectPrincipalRevoked,
} from '@/store/principal/principal-selectors';
import { workspaceUnmounted } from '../../../../../src/store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';

/** A lost socket retires readers, not the mounted workspace's unsaved input. */
export function useWorkspaceViewLifetime(workspaceId: string, denied: boolean) {
  const backendId = selectCurrentConnectionId().value;
  const principalId = selectPrincipalSnapshot().value?.principal.id;
  const revoked = selectPrincipalRevoked().value;
  const previous = useRef<
    { workspaceId: string; backendId: string; principalId?: string } | undefined
  >(undefined);
  useLayoutEffect(() => {
    const last = previous.current;
    if (
      last?.workspaceId === workspaceId &&
      (last.backendId !== backendId ||
        (principalId && last.principalId && principalId !== last.principalId))
    ) {
      store.dispatch(workspaceUnmounted(workspaceId));
    }
    if (denied || revoked) store.dispatch(workspaceUnmounted(workspaceId));
    previous.current = {
      workspaceId,
      backendId,
      principalId:
        principalId ??
        (last?.workspaceId === workspaceId && last.backendId === backendId
          ? last.principalId
          : undefined),
    };
  }, [workspaceId, backendId, principalId, denied, revoked]);
  useLayoutEffect(
    () => () => {
      store.dispatch(workspaceUnmounted(workspaceId));
    },
    [workspaceId],
  );
}
