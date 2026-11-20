/**
 * Settings → Passkeys IPC (app renderer → main). Main admits app windows only
 * (`features/passkeys/main/passkeys.ipc.ts`). Without the preload bridge (web
 * builds) device passkeys are unavailable.
 */
import { electronAPI } from '$lib/client/live/backend-transport';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import type {
  PasskeyDeviceDeleteRequest,
  PasskeyDeviceDeleteResult,
  PasskeyDeviceListResult,
} from '$shared/ipc/passkeys';

const CHANNELS = IPC_CHANNELS.PASSKEYS;

export async function listDevicePasskeys(): Promise<PasskeyDeviceListResult> {
  const api = electronAPI();
  if (!api) return { available: false };
  const result = (await api.invoke(CHANNELS.DEVICE_LIST)) as PasskeyDeviceListResult | undefined;
  return result ?? { available: false };
}

export async function deleteDevicePasskey(credentialId: string): Promise<boolean> {
  const api = electronAPI();
  if (!api) return false;
  const request: PasskeyDeviceDeleteRequest = { credentialId };
  const result = (await api.invoke(CHANNELS.DEVICE_DELETE, request)) as
    PasskeyDeviceDeleteResult | undefined;
  return result?.ok === true;
}
