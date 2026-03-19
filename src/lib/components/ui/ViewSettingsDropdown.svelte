<script lang="ts">
  /**
   * View Settings Dropdown
   *
   * A dropdown menu with an eye icon trigger that contains view settings toggles
   * for code editor panels (Fold, Wrap Lines, Split, Diff indicators).
   */

  import Fa from 'svelte-fa';
  import { faEye, faCheck } from '@fortawesome/free-solid-svg-icons';
  import DropdownMenu from './dropdown-menu.svelte';
  import { Button } from './button';
  import { selectFoldUnchanged, selectLineWrapping, selectDiffSideBySide } from '$lib/store/slices/ui-layout/ui-layout-selectors';
  import { toggleFoldUnchanged, toggleLineWrapping, toggleDiffSideBySide } from '$lib/store/slices/ui-layout/ui-layout-slice';
  import { dispatch } from '$lib/store/redux-dispatch-bridge';

  interface Props {
    /** Show fold unchanged toggle */
    showFold?: boolean;
    /** Show wrap lines toggle */
    showWrap?: boolean;
    /** Show split/unified diff toggle */
    showSplit?: boolean;
    /** Show diff indicators toggle (for file editor) */
    showDiff?: boolean;
    /** Current state of diff indicators (bindable) */
    diffEnabled?: boolean;
    /** Additional class for the trigger button */
    class?: string;
    /** Size of the trigger button */
    size?: 'xs' | 'sm' | 'md';
  }

  let {
    showFold = true,
    showWrap = true,
    showSplit = true,
    showDiff = false,
    diffEnabled = $bindable(true),
    class: className = '',
    size = 'xs',
  }: Props = $props();

  const foldUnchanged = selectFoldUnchanged();
  const lineWrapping = selectLineWrapping();
  const diffSideBySide = selectDiffSideBySide();

  let dropdownOpen = $state(false);

  const buttonSizeMap = {
    xs: 'icon-xs' as const,
    sm: 'icon-sm' as const,
    md: 'icon' as const,
  };
</script>

<DropdownMenu bind:open={dropdownOpen} align="end" contentClass="p-0!">
  {#snippet trigger({ toggle }: { toggle: () => void })}
    <Button
      variant="ghost-light"
      size={buttonSizeMap[size]}
      onclick={toggle}
      title="View settings"
      class={className}
    >
      <Fa icon={faEye} size="xs" />
    </Button>
  {/snippet}

  {#snippet content({ close }: { close: () => void })}
  <div class="w-full text-xs text-subtle px-2 pt-2 pb-1">
    View options
  </div>
      {#if showFold}
        <button
          type="button"
          class="flex items-center gap-2 w-full pl-2 pr-3 py-1.5 text-sm hover:bg-muted/50 cursor-pointer transition-colors"
          onclick={() => dispatch(toggleFoldUnchanged())}
        >
          <span class="w-3 h-3 flex items-center justify-center">
            {#if $foldUnchanged}
              <Fa icon={faCheck} size="xs" class="text-accent" />
            {/if}
          </span>
          <span>Fold unchanged</span>
        </button>
      {/if}

      {#if showWrap}
        <button
          type="button"
          class="flex items-center gap-2 w-full pl-2 pr-3 py-1.5 text-sm hover:bg-muted/50 cursor-pointer transition-colors"
          onclick={() => dispatch(toggleLineWrapping())}
        >
          <span class="w-3 h-3 flex items-center justify-center">
            {#if $lineWrapping}
              <Fa icon={faCheck} size="xs" class="text-accent" />
            {/if}
          </span>
          <span>Wrap lines</span>
        </button>
      {/if}

      {#if showSplit}
        <button
          type="button"
          class="flex items-center gap-2 w-full pl-2 pr-3 py-1.5 text-sm hover:bg-muted/50 cursor-pointer transition-colors"
          onclick={() => dispatch(toggleDiffSideBySide())}
        >
          <span class="w-3 h-3 flex items-center justify-center">
            {#if $diffSideBySide}
              <Fa icon={faCheck} size="xs" class="text-accent" />
            {/if}
          </span>
          <span>Split view</span>
        </button>
      {/if}

      {#if showDiff}
        <button
          type="button"
          class="flex items-center gap-2 w-full pl-2 pr-3 py-1.5 text-sm hover:bg-muted/50 cursor-pointer transition-colors"
          onclick={() => (diffEnabled = !diffEnabled)}
        >
          <span class="w-3 h-3 flex items-center justify-center">
            {#if diffEnabled}
              <Fa icon={faCheck} size="xs" class="text-accent" />
            {/if}
          </span>
          <span>Diff indicators</span>
        </button>
      {/if}
  {/snippet}
</DropdownMenu>
