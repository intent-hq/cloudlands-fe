// Import global styles
import '../src/app.css';
import '@fontsource-variable/inter';

import { beforeMount } from '@playwright/experimental-ct-svelte/hooks';
import type { SvelteComponent } from 'svelte';
import { waitForCaptureStability } from '../src/lib/component-catalog/capture-stability';
import {
  validatePreviewDefinition,
  type PreviewDefinition,
} from '../src/lib/component-catalog/preview-definition';
import { store } from '../src/store/renderer/configured-store';
import { guestSessionsListUnavailable } from '../src/store/renderer/slices/guest-sessions/guest-sessions-slice';
import { registerMockIpcHandler } from '../src/shared/ipc-mock-router';
import { startChatFixtureSagas } from '../src/test/chat-fixture-sagas';
import { installMockElectronBridge } from '../src/test/ct-mock-electron-bridge';
import { createChatDraftFixture } from '../src/test/fixtures/chat-drafts';

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
// Answer every composer's draft restore, as the app's root sagas do. A ChatPanel
// whose `drafts.get` goes unanswered shows the draft loading gate until its 5 s
// fallback, and removing the gate then shifts every message row (cloudlands-fe#4160).
// Starting it here covers every host and preview: a host's own
// startRootStoreLifecycle re-runs store.init(), which keeps this store and its
// sagas. A host that needs its own transport calls startChatFixtureSagas with it,
// which routes requests there until the host stops it.
const chatDrafts = createChatDraftFixture();
startChatFixtureSagas(store, chatDrafts.client);

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
  /** Saved composer drafts the default `drafts.get` fixture restores. */
  chatDrafts?: Array<{ workspaceId: string; agentId: string; text: string }>;
}

interface PreviewHooksConfig {
  previewScene?: {
    scene: string;
    state: string;
  };
}

// Registered before the preview hook on purpose: ct-svelte keeps the LAST
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
  for (const draft of hooksConfig?.chatDrafts ?? []) {
    chatDrafts.seed(draft.workspaceId, draft.agentId, draft.text);
  }
});

beforeMount<PreviewHooksConfig>(async ({ hooksConfig, App }) => {
  const preview = hooksConfig?.previewScene;
  if (!preview) return;
  const loadDefinition = previewDefinitionLoadersByScene.get(preview.scene);
  if (!loadDefinition) {
    throw new Error(`Preview “${preview.scene}” is not registered in the CT browser bundle.`);
  }
  const definition = validatePreviewDefinition(await loadDefinition(), preview.scene);
  const previewState = definition.states[preview.state];
  if (!previewState) {
    throw new Error(`Preview “${preview.scene}” has no state “${preview.state}”.`);
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

window.__INTENT_PREVIEW_CT__ = { waitForCaptureStability };

declare global {
  interface Window {
    __INTENT_PREVIEW_CT__: {
      waitForCaptureStability: typeof waitForCaptureStability;
    };
  }
}
