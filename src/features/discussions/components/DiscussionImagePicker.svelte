<script lang="ts">
  import Fa from 'svelte-fa';
  import { faImage } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { m } from '$shared/paraglide/messages.js';

  let { disabled = false, onSelect }: { disabled?: boolean; onSelect: (files: File[]) => void } =
    $props();
  let input: HTMLInputElement | null = $state(null);
</script>

<Input
  bind:ref={input}
  type="file"
  accept="image/png,image/jpeg,image/gif,image/webp"
  multiple
  class="hidden"
  onchange={(event: Event & { currentTarget: HTMLInputElement }) => {
    onSelect([...(event.currentTarget.files ?? [])]);
    event.currentTarget.value = '';
  }}
/>
<Button
  variant="ghost"
  size="icon-sm"
  {disabled}
  aria-label={m.workspace_discussion_attachImage_label()}
  tooltip={m.workspace_discussion_attachImage_label()}
  onmousedown={(event) => event.preventDefault()}
  onclick={() => input?.click()}><Fa icon={faImage} size="sm" /></Button
>
