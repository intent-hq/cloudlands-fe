<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import HomeWorkspaceDetail from './HomeWorkspaceDetail.svelte';
  import { getFocusedChatSuggestions } from '$features/hardware-console/prompt-picker/chat-suggestions';
  import { setupHomeWorkspaceLinksFixtures } from '../../test/fixtures/home-workspace-links';

  const { workspace, dispose } = untrack(() =>
    setupHomeWorkspaceLinksFixtures({
      href: 'https://example.com/review',
      title: 'Review workspace links',
      repository: true,
      nodeOwned: false,
      messageSuffix: '\n\n<!-- suggested-prompts\nRun the tests.\nOpen the PR.\n-->',
    }),
  );
  (window as unknown as { __homePromptTarget: unknown }).__homePromptTarget =
    getFocusedChatSuggestions;
  onDestroy(dispose);
</script>

<div
  data-home-prompt-picker
  style:width="640px"
  style:height="800px"
  class="bg-background text-foreground"
  style:container-type="inline-size"
  style:container-name="home-panel"
>
  <HomeWorkspaceDetail {workspace} onclose={() => {}} />
</div>
