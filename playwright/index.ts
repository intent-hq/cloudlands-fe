// Import global styles
import '../src/app.css';

import {
  installPreviewBrowserApi,
  registerPreviewLoader,
} from '../src/lib/component-catalog/preview-discovery';
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

registerPreviewLoader('button', () => import('../src/lib/components/ui/button/button.preview'));
registerPreviewLoader(
  'workspace-hover-card',
  () => import('../src/lib/components/workspace/workspace-hover-card.preview.svelte'),
);
installPreviewBrowserApi(window);
