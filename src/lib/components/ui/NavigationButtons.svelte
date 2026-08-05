<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { TooltipShortcut } from '$lib/components/ui/tooltip';
  import Fa from 'svelte-fa';
  import {
  faChevronLeft,
  faChevronRight,
} from '@fortawesome/free-solid-svg-icons';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    canGoBack: boolean;
    canGoForward: boolean;
    onNavigateBack: () => void;
    onNavigateForward: () => void;
  }

  let { canGoBack, canGoForward, onNavigateBack, onNavigateForward }: Props = $props();
</script>

<div class="flex items-center h-full -ml-3 mr-3 relative">
  <div class="flex items-center h-full">
    <TooltipShortcut label={m.ui_navButtons_goBack_tooltip()} shortcut="alt+←" side="bottom" delayDuration={300}>
      <Button
        size="xs"
        variant="ghost"
        onclick={onNavigateBack}
        disabled={!canGoBack}
        class="rounded-none h-full pl-4! pr-1.5!"
      >
        <Fa icon={faChevronLeft} size="sm" />
      </Button>
    </TooltipShortcut>
    <TooltipShortcut label={m.ui_navButtons_goForward_tooltip()} shortcut="alt+→" side="bottom" delayDuration={300}>
      <Button
        size="xs"
        variant="ghost"
        onclick={onNavigateForward}
        disabled={!canGoForward}
        class="rounded-none h-full pr-4! pl-1.5!"
      >
        <Fa icon={faChevronRight} size="sm" />
      </Button>
    </TooltipShortcut>
  </div>
  <!-- Full height border -->
  <div class="absolute right-0 top-0 bottom-0 w-[1px] bg-border"></div>
</div>
