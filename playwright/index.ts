// Import global styles
import '../src/app.css';

import { beforeMount } from '@playwright/experimental-ct-svelte/hooks';
import type { SvelteComponent } from 'svelte';
import { waitForCaptureStability } from '../src/lib/component-catalog/capture-stability';
import { collectGeometry } from '../src/lib/component-catalog/geometry-probe';
import type { PreviewDefinition } from '../src/lib/component-catalog/preview-definition';
import { store } from '../src/store/renderer/configured-store';

// Apply any global setup needed for component testing
// This runs before each component is mounted

// CT-safe store bootstrap (intent-hq/monorepo#2224): components read Redux
// selectors at mount, which throws before Store.init(). Initialize the real
// renderer store once with its default state — no app sagas or IPC-dependent
// middleware run in the CT bundle. The window flag lets RendererStore tolerate
// init() being called outside Svelte component initialization.
(window as { __PLAYWRIGHT_CT_STORE_BOOTSTRAP__?: boolean }).__PLAYWRIGHT_CT_STORE_BOOTSTRAP__ =
  true;
store.init();

interface GeometryHooksConfig {
  geometrySnapshot?: {
    definition: PreviewDefinition<Record<string, unknown>>;
    scene: string;
    state: string;
  };
}

beforeMount<GeometryHooksConfig>(async ({ hooksConfig, App }) => {
  const geometry = hooksConfig?.geometrySnapshot;
  if (!geometry) return;
  if (geometry.definition.id !== geometry.scene) {
    throw new Error(
      `Preview “${geometry.definition.id}” does not match geometry scene “${geometry.scene}”.`,
    );
  }
  const previewState = geometry.definition.states[geometry.state];
  if (!previewState) {
    throw new Error(`Preview “${geometry.scene}” has no state “${geometry.state}”.`);
  }
  const cleanup = previewState.setup?.();
  const component = new App({ props: previewState.props });
  const destroy = component.$destroy.bind(component);
  component.$destroy = () => {
    try {
      destroy();
    } finally {
      cleanup?.();
    }
  };
  return component as SvelteComponent;
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
