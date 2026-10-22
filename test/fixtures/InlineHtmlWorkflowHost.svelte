<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import ChatPanelComposerGeometryHost from '$lib/components/chat/__tests__/ChatPanelComposerGeometryHost.svelte';
  import { store } from '$store/renderer/store';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { inlineVisualsSaga } from '$store/renderer/slices/inline-visuals/sagas/inline-visuals-saga';
  import { admitLegacyPrincipal } from '../../src/test/fixtures/principal-state';
  import { createInlineVisualFiles } from './inline-visual-files';
  import { workflowClampMessage } from './inline-html-workflow-demo';
  import type { AgentMessage } from '$shared/types';

  let {
    width = 960,
    height = 1000,
    theme = 'light',
    readFailure = false,
  }: {
    width?: number;
    height?: number;
    theme?: 'light' | 'dark';
    readFailure?: boolean;
  } = $props();
  const files = createInlineVisualFiles();
  files.fault(
    untrack(() => readFailure),
    false,
  );
  const dispose = startRootStoreLifecycle(store, {
    startSagas: (appStore) => [
      appStore.runSaga(function* workflowPersistence() {
        yield* inlineVisualsSaga(files.client);
      }),
    ],
  });
  admitLegacyPrincipal();
  onDestroy(dispose);
  const messages: AgentMessage[] = [
    {
      id: 'persistent-clamp-demo',
      role: 'assistant',
      timestamp: '2026-10-22T21:00:00.000Z',
      contentBlocks: [{ id: 'visual-text', type: 'text', text: workflowClampMessage() }],
    },
  ];

  export function inspect() {
    return { files: files.files(), requests: files.requests };
  }
  export function fault(read: boolean, write: boolean) {
    files.fault(read, write);
  }
  export function update(next: { width?: number; height?: number; theme?: 'light' | 'dark' }) {
    if (next.width !== undefined) width = next.width;
    if (next.height !== undefined) height = next.height;
    if (next.theme !== undefined) theme = next.theme;
  }
</script>

<ChatPanelComposerGeometryHost
  {width}
  {height}
  {theme}
  {messages}
  draft="Please compare this with the other arm."
  initializeStore={false}
/>
