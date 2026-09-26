import { electronAPI } from '$lib/client/live/backend-transport';
import { store as appStore } from '$store/renderer/store';
import {
  selectLabsGitLabEnabled,
  selectLabsMultiplayerEnabled,
} from '$store/renderer/slices/user-preferences/user-preferences-selectors';
import { COLLABORATION_AUTH, type CollaborationAction, type CollaborationView } from '../types';
import { openPalette } from '$store/renderer/slices/palette/palette-slice';

let active: string | null = null;
let hide: (() => void) | undefined;
function collaborationPolicy() {
  return {
    multiplayer: selectLabsMultiplayerEnabled.select(appStore.state),
    gitlab: selectLabsGitLabEnabled.select(appStore.state),
  };
}
/** Direct ephemeral IPC: no PAT in Redux, logger arguments, mock-router traces, or host RPC. */
export async function collaborationAction(action: CollaborationAction): Promise<void> {
  const api = electronAPI();
  if (!api || !active) return;
  const requestId = active;
  const policy = collaborationPolicy();
  if (!policy.multiplayer && action.type !== 'cancel' && action.type !== 'policy') return;
  await api.invoke(COLLABORATION_AUTH.ACTION, { requestId, action });
}
export function openCollaborationSignIn(): void {
  if (!collaborationPolicy().multiplayer) return;
  void electronAPI()
    ?.invoke(COLLABORATION_AUTH.OPEN)
    .catch(() => {});
}
export function syncCollaborationPolicy(): void {
  const policy = collaborationPolicy();
  if (!policy.multiplayer) hide?.();
  void electronAPI()
    ?.invoke(COLLABORATION_AUTH.POLICY, policy)
    .catch(() => {});
}
export function installCollaborationAuth(handlers: {
  show(view: CollaborationView): void;
  dismiss(): void;
}): () => void {
  const api = electronAPI();
  if (!api) return () => {};
  hide = handlers.dismiss;
  const showId = api.on(COLLABORATION_AUTH.SHOW, (value: unknown) => {
    const view = value as CollaborationView;
    if (!view || typeof view.requestId !== 'string') return;
    const first = active !== view.requestId;
    active = view.requestId;
    if (first) syncCollaborationPolicy();
    if (!collaborationPolicy().multiplayer) {
      if (first) appStore.dispatch(openPalette('Multiplayer')); // i18n-ignore (feature command search)
      return;
    }
    handlers.show(view);
  });
  const dismissId = api.on(COLLABORATION_AUTH.DISMISS, (value: unknown) => {
    if ((value as { requestId?: string })?.requestId !== active) return;
    active = null;
    handlers.dismiss();
  });
  return () => {
    void collaborationAction({ type: 'cancel' }).catch(() => {});
    api.offById(COLLABORATION_AUTH.SHOW, showId);
    api.offById(COLLABORATION_AUTH.DISMISS, dismissId);
    active = null;
    hide = undefined;
  };
}
