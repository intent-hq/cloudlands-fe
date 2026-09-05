// Import global styles
import '../src/app.css';

import { waitForCaptureStability } from '../src/lib/component-catalog/capture-stability';
import { collectGeometry } from '../src/lib/component-catalog/geometry-probe';
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

window.__INTENT_GEOMETRY_CT__ = { collectGeometry, waitForCaptureStability };

declare global {
  interface Window {
    __INTENT_GEOMETRY_CT__: {
      collectGeometry: typeof collectGeometry;
      waitForCaptureStability: typeof waitForCaptureStability;
    };
  }
}
