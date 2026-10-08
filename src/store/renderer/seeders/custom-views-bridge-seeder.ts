import { hasCapability } from '$lib/utils/platform-capabilities';
import { registerMockIpcHandler } from '$shared/ipc-mock-router';
import { customViewsChannels, type CustomViewsResponse } from '$shared/types/custom-views';

const desktopOnly = {
  success: false,
  error: { code: 'desktop-only', message: 'Custom views require the Intent desktop app.' },
} satisfies CustomViewsResponse;

/** Generated invokes use the router in every build; forward this desktop-owned domain to preload. */
export function registerCustomViewsBridge(): void {
  for (const channel of Object.values(customViewsChannels)) {
    registerMockIpcHandler(channel, async (payload?: unknown) => {
      const bridge = typeof window !== 'undefined' ? window.electronAPI : undefined;
      if (!hasCapability('customViews') || typeof bridge?.invoke !== 'function') return desktopOnly;
      return payload === undefined ? bridge.invoke(channel) : bridge.invoke(channel, payload);
    });
  }
}

registerCustomViewsBridge();
