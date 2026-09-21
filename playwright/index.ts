// Import global styles
import '../src/app.css';
import '@fontsource-variable/inter';

import { beforeMount } from '@playwright/experimental-ct-svelte/hooks';
import type { SvelteComponent } from 'svelte';
import { waitForCaptureStability } from '../src/lib/component-catalog/capture-stability';
import { collectGeometry } from '../src/lib/component-catalog/geometry-probe';
import {
  validatePreviewDefinition,
  type PreviewDefinition,
} from '../src/lib/component-catalog/preview-definition';
import { store } from '../src/store/renderer/configured-store';
import { guestSessionsListUnavailable } from '../src/store/renderer/slices/guest-sessions/guest-sessions-slice';
import { registerMockIpcHandler } from '../src/shared/ipc-mock-router';
import { installMockElectronBridge } from '../src/test/ct-mock-electron-bridge';

// CT-safe store bootstrap (intent-hq/monorepo#2224): components read Redux
// selectors at mount, which throws before Store.init(). Initialize the real
// renderer store once with its default state — no app sagas or IPC-dependent
// middleware run in the CT bundle. The window flag lets RendererStore tolerate
// init() being called outside Svelte component initialization.
(window as { __PLAYWRIGHT_CT_STORE_BOOTSTRAP__?: boolean }).__PLAYWRIGHT_CT_STORE_BOOTSTRAP__ =
  true;
store.init();
// No app sagas run here, so the guest-sessions saga never settles the window
// identity (`selectWindowIdentitySettled`). Outside Electron that saga settles
// it as an owner window (`guestSessionsListUnavailable`); do the same so the
// fail-closed owner-only surfaces (intent-hq/cloudlands-fe#2652) render in
// previews as they do in the product instead of staying withheld forever.
store.dispatch(guestSessionsListUnavailable());

const previewDefinitionLoaders = import.meta.glob<PreviewDefinition<Record<string, unknown>>>(
  '../src/**/*.preview.{ts,svelte}',
  { import: 'preview' },
);
const previewDefinitionLoadersByScene = new Map<
  string,
  () => Promise<PreviewDefinition<Record<string, unknown>>>
>();
for (const [path, loader] of Object.entries(previewDefinitionLoaders)) {
  const scene = path.match(/\/([^/]+)\.preview\.(?:ts|svelte)$/)?.[1];
  if (scene) previewDefinitionLoadersByScene.set(scene, loader);
}

interface MockHooksConfig {
  /**
   * Static daemon answers by JSON-RPC method, served through a mock
   * `window.electronAPI` (intent-hq/intent#5276). A fixture that mounts a code
   * path which reads from the daemon on mount (e.g. `ChatPanel`'s
   * `agent.getQueue` hydration) needs this, or it exercises its caught
   * "Backend bridge unavailable" fallback under passing geometry assertions.
   */
  mockBackend?: Record<string, unknown>;
  /** Static legacy renderer→main IPC answers by invoke channel. */
  mockIpc?: Record<string, unknown>;
}

interface GeometryHooksConfig {
  geometrySnapshot?: {
    scene: string;
    state: string;
  };
}

// Registered before the geometry hook on purpose: ct-svelte keeps the LAST
// before-mount hook's return value as the mounted component, so a hook that
// returns nothing must not run after one that returns a component.
beforeMount<MockHooksConfig>(async ({ hooksConfig }) => {
  if (hooksConfig?.mockBackend) {
    installMockElectronBridge(
      Object.fromEntries(
        Object.entries(hooksConfig.mockBackend).map(([method, result]) => [method, () => result]),
      ),
    );
  }
  for (const [channel, response] of Object.entries(hooksConfig?.mockIpc ?? {})) {
    registerMockIpcHandler(channel, () => response);
  }
});

beforeMount<GeometryHooksConfig>(async ({ hooksConfig, App }) => {
  const geometry = hooksConfig?.geometrySnapshot;
  if (!geometry) return;
  const loadDefinition = previewDefinitionLoadersByScene.get(geometry.scene);
  if (!loadDefinition) {
    throw new Error(`Preview “${geometry.scene}” is not registered in the CT browser bundle.`);
  }
  const definition = validatePreviewDefinition(await loadDefinition(), geometry.scene);
  const previewState = definition.states[geometry.state];
  if (!previewState) {
    throw new Error(`Preview “${geometry.scene}” has no state “${geometry.state}”.`);
  }
  const cleanup = previewState.setup?.();
  let component: SvelteComponent;
  try {
    component = new App({ props: previewState.props });
  } catch (error) {
    cleanup?.();
    throw error;
  }
  const destroy = component.$destroy.bind(component);
  component.$destroy = () => {
    try {
      destroy();
    } finally {
      cleanup?.();
    }
  };
  return component;
});

window.__INTENT_GEOMETRY_CT__ = { collectGeometry, waitForCaptureStability };

declare global {
  interface Window {
    __INTENT_GEOMETRY_CT__: {
      collectGeometry: typeof collectGeometry;
      waitForCaptureStability: typeof waitForCaptureStability;
    };
  }
}
