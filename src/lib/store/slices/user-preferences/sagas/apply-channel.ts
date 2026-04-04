import { autoUpdateClient } from "$features/auto-update/auto-update.client";
import type { UpdateChannel } from "$features/auto-update/types";

export async function applyChannel(enabled: boolean): Promise<void> {
  try {
    const channel: UpdateChannel = enabled ? "beta" : "stable";
    await autoUpdateClient.setChannel(channel);
  } catch {
    // Ignore channel errors
  }
}