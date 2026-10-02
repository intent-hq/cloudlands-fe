<script lang="ts">
  import PresenceAvatarStack from '../components/PresenceAvatarStack.svelte';
  import { selectWorkspacePresencePeople } from '$store/renderer/slices/presence/presence-selectors';

  let { workspaceId }: { workspaceId: string } = $props();
  const people$ = selectWorkspacePresencePeople(workspaceId);
</script>

<PresenceAvatarStack people={$people$} maxVisible={8} />
