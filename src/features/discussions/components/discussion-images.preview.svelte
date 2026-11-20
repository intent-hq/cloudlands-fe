<script module lang="ts">
  import { catalogNow } from '$lib/component-catalog/catalog-clock';
  import { definePreview } from '$lib/component-catalog/preview-definition';
  type State = 'thread' | 'image-only' | 'reply' | 'failed';
  interface Props {
    state?: State;
  }
  export const preview = definePreview<Props>({
    id: 'discussion-images',
    title: 'Discussion images',
    defaultState: 'thread',
    states: {
      thread: { props: { state: 'thread' } },
      'image-only': { props: { state: 'image-only' } },
      reply: { props: { state: 'reply' } },
      failed: { props: { state: 'failed' } },
    },
  });
</script>

<script lang="ts">
  import { untrack } from 'svelte';
  import type { DiscussionMessage } from '$shared/types/workspace-discussion';
  import { m } from '$shared/paraglide/messages.js';
  import DiscussionThread from './DiscussionThread.svelte';
  import type { DiscussionPendingDisplay } from './discussion-display';
  import { joinDiscussionBody } from '../discussion-images';

  let { state: previewState = 'thread' }: Props = $props();
  const workspaceId = 'discussion-images-preview';
  const sam = { principalId: 'sam', displayName: 'Sam Breed', login: 'sam', avatarUrl: null };
  const alex = { principalId: 'alex', displayName: 'Alex', login: 'alex', avatarUrl: null };
  const asset = (id: string) => `workspace-asset://${workspaceId}/${id}`;

  // The UI sandbox has no workspace-asset protocol; serve inline fixtures instead.
  const svg = (w: number, h: number, body: string) =>
    `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`)}`;
  const fixtures: Record<string, string> = {
    [asset('sidebar-12345678.png')]: svg(
      960,
      600,
      '<rect width="960" height="600" fill="#f4f4f5"/><rect width="220" height="600" fill="#e4e4e7"/><rect x="24" y="32" width="150" height="14" rx="7" fill="#a1a1aa"/><rect x="24" y="72" width="120" height="12" rx="6" fill="#d4d4d8"/><rect x="24" y="100" width="140" height="12" rx="6" fill="#d4d4d8"/><rect x="24" y="128" width="110" height="12" rx="6" fill="#6366f1"/><rect x="260" y="40" width="420" height="22" rx="8" fill="#27272a"/><rect x="260" y="90" width="660" height="180" rx="16" fill="#fff"/><rect x="260" y="300" width="320" height="260" rx="16" fill="#fff"/><rect x="600" y="300" width="320" height="260" rx="16" fill="#c7d2fe"/>',
    ),
    [asset('sunset-87654321.jpg')]: svg(
      800,
      1000,
      '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1e3a8a"/><stop offset=".55" stop-color="#f97316"/><stop offset="1" stop-color="#fde68a"/></linearGradient></defs><rect width="800" height="1000" fill="url(#g)"/><circle cx="400" cy="560" r="120" fill="#fef3c7"/><path d="M0 700 L220 520 L420 720 L600 560 L800 720 L800 1000 L0 1000Z" fill="#1f2937"/>',
    ),
    [asset('chart-11223344.png')]: svg(
      900,
      420,
      '<rect width="900" height="420" fill="#fff"/><g fill="#6366f1"><rect x="80" y="240" width="80" height="140" rx="6"/><rect x="220" y="160" width="80" height="220" rx="6"/><rect x="360" y="200" width="80" height="180" rx="6"/><rect x="500" y="90" width="80" height="290" rx="6"/><rect x="640" y="130" width="80" height="250" rx="6"/></g><rect x="60" y="380" width="780" height="2" fill="#d4d4d8"/>',
    ),
  };
  $effect(() => {
    const swap = (node: Node) => {
      const images =
        node instanceof HTMLImageElement
          ? [node]
          : node instanceof Element
            ? [...node.querySelectorAll('img')]
            : [];
      for (const image of images) {
        const fixture = fixtures[image.getAttribute('src') ?? ''];
        if (fixture) image.src = fixture;
      }
    };
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'attributes') swap(record.target);
        else record.addedNodes.forEach(swap);
      }
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['src'],
    });
    swap(document.body);
    return () => observer.disconnect();
  });

  const sidebar = { name: 'sidebar.png', url: asset('sidebar-12345678.png') };
  const sunset = { name: 'sunset.jpg', url: asset('sunset-87654321.jpg') };
  const chart = { name: 'chart.png', url: asset('chart-11223344.png') };
  const today = new Date(catalogNow());
  today.setHours(12, 0, 0, 0);
  function message(id: number, body: string, author = alex): DiscussionMessage {
    const date = new Date(today);
    date.setMinutes(id * 3);
    return {
      id: `preview-${id}`,
      workspaceId,
      sequence: id,
      body,
      author,
      createdAt: date.toISOString(),
    };
  }
  const shot = message(
    1,
    joinDiscussionBody('Here is the new sidebar spacing. Thoughts?', [sidebar]),
  );
  const pair = message(2, joinDiscussionBody('', [sunset, chart]), sam);
  let messages = $state<DiscussionMessage[]>([]);
  let pending = $state<DiscussionPendingDisplay[]>([]);
  let draft = $state('');
  let reply = $state<DiscussionMessage | null>(null);
  untrack(() => {
    const scene = previewState;
    messages = [shot, pair, message(3, 'Love the second chart. Ship it.')];
    if (scene === 'thread') draft = joinDiscussionBody('Updated version:', [chart, sidebar]);
    if (scene === 'image-only') draft = joinDiscussionBody('', [sunset]);
    if (scene === 'reply') reply = pair;
    if (scene === 'failed')
      pending = [
        {
          id: 'pending-failure',
          body: joinDiscussionBody('One more angle', [sunset]),
          author: sam,
          createdAt: today.toISOString(),
          status: 'failed',
          error: m.workspace_discussion_send_error(),
        },
      ];
  });
</script>

<div
  class="flex h-[720px] w-full min-w-0 max-w-[420px] flex-col overflow-hidden rounded-[10px] border border-border bg-background"
>
  <DiscussionThread
    {workspaceId}
    {messages}
    {draft}
    pendingMessages={pending}
    replyTo={reply}
    onCancelReply={() => (reply = null)}
    showEmptyState={false}
    focusComposer={false}
    isPanelFocused
    onDraftChange={(value) => (draft = value)}
    onSend={() => {
      messages = [...messages, message(messages.length + 1, draft, sam)];
      draft = '';
      reply = null;
    }}
    onReply={(next) => (reply = next)}
    onRetry={() => {}}
    onLoadOlder={() => {}}
  />
</div>
