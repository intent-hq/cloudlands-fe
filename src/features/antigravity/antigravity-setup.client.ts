import { invoke } from '$lib/electron-bridge';
import { ANTIGRAVITY_CHANNELS } from '$shared/ipc/channels';
import type {
  AntigravitySetupAction,
  AntigravitySetupResult,
} from '$shared/types/antigravity-setup';

export function requestAntigravitySetup(
  action: AntigravitySetupAction,
  operationId?: string,
): Promise<AntigravitySetupResult> {
  return invoke(ANTIGRAVITY_CHANNELS.SETUP, { action, operationId });
}

export function closeAntigravitySetup(): Promise<void> {
  return invoke(ANTIGRAVITY_CHANNELS.CLOSE_SETUP);
}
