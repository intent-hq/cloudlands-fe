import { autoUpdateStore } from "$features/auto-update/auto-update.store.svelte";

export async function applyChannel(enabled: boolean): Promise<void> {
  try {
    const channel = enabled ? "beta" : "stable";
    await autoUpdateStore.setChannel(channel);
  } catch {
    // Ignore channel errors
  }
}