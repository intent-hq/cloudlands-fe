<script lang="ts">
  import type { Workspace } from '$shared/types';
  import { m } from '$shared/paraglide/messages.js';
  import { USER_MESSAGE_SURFACE_CLASS, USER_MESSAGE_TEXT_CLASS } from './user-message-surface';
  import { Button } from '$lib/components/ui/button';

  interface Props {
    text: string;
    workspace?: Workspace | null;
    onActivate: () => void;
  }

  let { text, workspace: _workspace = null, onActivate }: Props = $props();
  const descriptionId = $props.id();
</script>

<Button
  variant="plain"
  type="button"
  data-testid="pinned-user-prompt"
  data-surface-role="pinned-user-prompt-bubble"
  class="pointer-events-auto block h-auto min-h-0 w-full min-w-0 shrink whitespace-normal border-0 px-3! py-2! text-left font-normal {USER_MESSAGE_SURFACE_CLASS} focus-visible:ring-2"
  style="transition: none"
  onclick={onActivate}
  onkeydown={(event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onActivate();
  }}
  aria-label={m.chat_stickyMessageHeader_scrollToPrevious_title()}
  aria-describedby={descriptionId}
  title={text}
>
  <span
    data-testid="pinned-user-prompt-text"
    class="block min-w-0 truncate whitespace-nowrap {USER_MESSAGE_TEXT_CLASS}"
  >
    {text}
  </span>
  <span id={descriptionId} class="sr-only">{text}</span>
</Button>
