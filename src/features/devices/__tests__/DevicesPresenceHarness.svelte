<script lang="ts">
  import PersonalDevices from '../PersonalDevices.svelte';
  import PresenceAvatarStack from '$features/presence/components/PresenceAvatarStack.svelte';
  import { selectWorkspacePresencePeople } from '$store/renderer/slices/presence/presence-selectors';

  let { workspaceId }: { workspaceId: string } = $props();
  const people$ = selectWorkspacePresencePeople(workspaceId);
</script>

<PersonalDevices />
<PresenceAvatarStack people={$people$} maxVisible={8} />
