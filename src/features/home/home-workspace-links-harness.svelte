<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import HomeWorkspaceDetail from './HomeWorkspaceDetail.svelte';
  import ChatPanel from '$lib/components/chat/ChatPanel.svelte';
  import LinkActionMenu from '$features/navigation/LinkActionMenu.svelte';
  import { setupHomeWorkspaceLinksFixtures } from '../../test/fixtures/home-workspace-links';
  import type { GithubLinkDefaultAction } from '$shared/utils/link-helpers';

  let {
    href = 'intent://local/file/src/main.ts',
    title = 'Review workspace links',
    width = 640,
    repository = true,
    enlarged = false,
    ordinaryChat = false,
    nodeOwned = false,
    githubLinkDefaultAction,
  }: {
    href?: string;
    title?: string;
    width?: number;
    repository?: boolean;
    enlarged?: boolean;
    ordinaryChat?: boolean;
    nodeOwned?: boolean;
    githubLinkDefaultAction?: GithubLinkDefaultAction;
  } = $props();
  const { workspace, agentId, agentName, dispose } = untrack(() =>
    setupHomeWorkspaceLinksFixtures({
      href,
      title,
      repository,
      nodeOwned,
      githubLinkDefaultAction,
    }),
  );
  let closed = $state(false);
  onDestroy(dispose);
</script>

<LinkActionMenu />

<div
  data-workspace-chat-review
  style:width="{width}px"
  style:height="800px"
  style:zoom={enlarged ? '1.5' : '1'}
  class="bg-background text-foreground"
  style:container-type="inline-size"
  style:container-name="home-panel"
>
  {#if closed}<p data-preview-closed>Preview closed</p>
  {:else if ordinaryChat}
    <ChatPanel
      {workspace}
      {agentId}
      {agentName}
      autoFocus={false}
      isInitialWorkspaceAgent={false}
    />
  {:else}
    <HomeWorkspaceDetail {workspace} onclose={() => (closed = true)} />
  {/if}
</div>
