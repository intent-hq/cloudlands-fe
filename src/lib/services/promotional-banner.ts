import type { PromotionalBannerResponse } from '$lib/types/promotional-banner';
import { invoke } from '$lib/electron-bridge';
import { IPC_CHANNELS } from '$shared/ipc-registry';

export async function fetchPromotionalBanners(): Promise<PromotionalBannerResponse> {
  try {
    const result = await invoke<{
      success: boolean;
      data?: PromotionalBannerResponse;
    }>(IPC_CHANNELS.BANNER.FETCH);

    if (result.success && result.data) {
      return Array.isArray(result.data) ? result.data : [];
    }
    return [];
  } catch {
    return [];
  }
}