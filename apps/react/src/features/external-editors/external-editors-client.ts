import { IPC_CHANNELS } from '$shared/ipc-registry';
import { store } from '../../store';
import { selectHostAdministrationContext } from '../../store/principal/principal-selectors';
import { backend } from '../backend/backend-transport';
import { createExternalEditorReadRuntime } from '../../../../../src/features/external-editors/external-editor-read';
import { createExternalEditorsClient } from '../../../../../src/features/external-editors/external-editors-client-factory';

const reads = createExternalEditorReadRuntime({
  backendRequest: <T>(...args: Parameters<typeof backend.backendRequest>) =>
    backend.backendRequest<T>(...args),
  getHostAdministrationContext: () => selectHostAdministrationContext.select(store.state),
});
// Only the active source route is bound: its handler deliberately ignores forceRefresh.
// No shared router registration, native detection, open handler or Store read at construction.
const routes = {
  [IPC_CHANNELS.EXTERNAL_EDITORS.DETECT_INSTALLED]: reads.detectInstalledEditors,
};
export const externalEditorsClient = createExternalEditorsClient({
  invoke: (channel, _params) => routes[channel](),
});
