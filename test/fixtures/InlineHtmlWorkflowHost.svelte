<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte';
  import PanelLayout from '$lib/components/layout/panel-system/PanelLayout.svelte';
  import InlineHtmlBlock from '$features/inline-html/InlineHtmlBlock.svelte';
  import { updateSession } from '$store/renderer/slices/agent-session/agent-session-slice';
  import ChatPanelComposerGeometryHost from '$lib/components/chat/__tests__/ChatPanelComposerGeometryHost.svelte';
  import { store } from '$store/renderer/store';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { inlineVisualsSaga } from '$store/renderer/slices/inline-visuals/sagas/inline-visuals-saga';
  import { admitLegacyPrincipal } from '../../src/test/fixtures/principal-state';
  import { createInlineVisualFiles } from './inline-visual-files';
  import { workflowClampDemo, workflowClampMessage } from './inline-html-workflow-demo';
  import { generatedSeasonsBeforeMessage, seasonsMessage } from './inline-html-seasons-demo';
  import type { AgentMessage } from '$shared/types';

  let {
    width = 960,
    height = 1000,
    theme = 'light',
    readFailure = false,
    mode = 'persistent',
    viewers = 1,
    demo = 'clamp',
  }: {
    width?: number;
    height?: number;
    theme?: 'light' | 'dark';
    readFailure?: boolean;
    mode?: 'persistent' | 'local-only' | 'remote-root';
    viewers?: 1 | 2;
    demo?: 'clamp' | 'seasons' | 'seasons-before';
  } = $props();
  const demoMessages = {
    clamp: workflowClampMessage,
    seasons: seasonsMessage,
    'seasons-before': () => generatedSeasonsBeforeMessage,
  };
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
      contentBlocks: [
        { id: 'visual-text', type: 'text', text: demoMessages[untrack(() => demo)]() },
      ],
    },
  ];
  onMount(() => {
    if (mode === 'remote-root')
      store.dispatch(
        updateSession('regular-composer-agent', {
          nodePath: '/remote/workspaces/clamp-demo',
          messages,
        }),
      );
  });

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

<div style:display="flex" style:gap="16px" data-workflow-mode={mode}>
  <section data-workflow-viewer="primary" style:width="{width}px">
    {#if mode === 'local-only'}
      <InlineHtmlBlock
        role="assistant"
        block={{ type: 'html', content: `${workflowClampDemo}\n`, metadata: { fenceClosed: true } }}
      />
    {:else}
      <ChatPanelComposerGeometryHost
        {width}
        {height}
        {theme}
        messages={mode === 'remote-root' ? [] : messages}
        draft="Please compare this with the other arm."
        initializeStore={false}
      />
    {/if}
  </section>
  {#if viewers === 2 && mode === 'persistent'}
    <section data-workflow-viewer="secondary" style:width="{width}px" style:height="{height}px">
      <PanelLayout
        workspaceId="chat-panel-composer-geometry"
        layoutId="chat-panel-composer-geometry"
      />
    </section>
  {/if}
</div>
