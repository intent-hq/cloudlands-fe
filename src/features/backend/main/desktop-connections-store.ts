/** Desktop wiring for the reusable connections registry. */
import { app, safeStorage } from 'electron';
import { createConnectionsStore } from './connections-store';
export { LOCAL_CONNECTION_ID, LOCAL_CONNECTION_LABEL } from './connections-store';
export type { ConnectionRecord, NewConnection } from './connections-store';

const store = createConnectionsStore({
  dataDir: () => app.getPath('userData'),
  tokenCodec: {
    encode: (token) =>
      safeStorage.isEncryptionAvailable()
        ? { encrypted: true, value: safeStorage.encryptString(token).toString('base64') }
        : { encrypted: false, value: token },
    decode: (token) =>
      token.encrypted ? safeStorage.decryptString(Buffer.from(token.value, 'base64')) : token.value,
  },
});
export const {
  onConnectionsMutated,
  list,
  findMatching,
  add,
  updateMetadata,
  replaceSecret,
  setHosts,
  getDetectHosts,
  setHostname,
  setDetectedDeviceKind,
  setDaemonVersion,
  setUpdateSupported,
  setDaemonMode,
  setTcAddress,
  forget,
  getActiveId,
  setActiveId,
  getDecryptedToken,
  listSyncRecords,
  applyRemoteSyncRecord,
  __drainWriteChainForTesting,
} = store;
