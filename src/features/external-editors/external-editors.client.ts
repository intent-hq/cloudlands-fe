/**
 * External Editors client — thin renderer wrapper around the
 * `external-editors:detect-installed` IPC channel, mirroring the other feature
 * IPC clients (e.g. accept-changes.client.ts). Keeps the raw `invoke` out of the
 * lifecycle read middleware so the detect read can be mocked in isolation.
 */
import { invoke } from '$lib/electron-bridge';
import {
  createExternalEditorsClient,
  type DetectInstalledResponse,
} from './external-editors-client-factory';

// Source compatibility binding; remove when its lifecycle IPC consumers retire at cutover.
export const externalEditorsClient = createExternalEditorsClient({
  invoke: (channel, params) => invoke<DetectInstalledResponse>(channel, params),
});
