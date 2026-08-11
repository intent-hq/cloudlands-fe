<script lang="ts">
  /**
   * View Settings Dropdown
   *
   * A dropdown menu with a settings trigger that contains view settings toggles
   * for code editor panels (Fold, Wrap Lines, Split, Diff indicators).
   */

  import Fa from 'svelte-fa';
  import { faSliders } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import * as Menu from '$lib/components/ui/menu';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    /** Show fold unchanged toggle */
    showFold?: boolean;
    foldEnabled?: boolean;
    onToggleFold?: () => void;
    /** Show wrap lines toggle */
    showWrap?: boolean;
    wrapEnabled?: boolean;
    onToggleWrap?: () => void;
    /** Show split/unified diff toggle */
    showSplit?: boolean;
    splitEnabled?: boolean;
    onToggleSplit?: () => void;
    /** Show diff indicators toggle (for file editor) */
    showDiff?: boolean;
    diffEnabled?: boolean;
    onToggleDiff?: () => void;
    /** Show rich Markdown preview toggle (for Markdown files) */
    showPreview?: boolean;
    previewEnabled?: boolean;
    onTogglePreview?: () => void;
    /** Show aggregate file expansion toggle */
    showExpand?: boolean;
    expanded?: boolean;
    onToggleExpand?: () => void;
    /** Additional class for the trigger button */
    class?: string;
    /** Size of the trigger button */
    size?: 'xs' | 'sm' | 'md';
  }

  let {
    showFold = true,
    foldEnabled = false,
    onToggleFold,
    showWrap = true,
    wrapEnabled = false,
    onToggleWrap,
    showSplit = true,
    splitEnabled = false,
    onToggleSplit,
    showDiff = false,
    diffEnabled = false,
    onToggleDiff,
    showPreview = false,
    previewEnabled = false,
    onTogglePreview,
    showExpand = false,
    expanded = false,
    onToggleExpand,
    class: className = '',
    size = 'xs',
  }: Props = $props();

  let dropdownOpen = $state(false);

  const buttonSizeMap = {
    xs: 'icon-xs' as const,
    sm: 'icon-sm' as const,
    md: 'icon' as const,
  };
</script>

<Menu.Root bind:open={dropdownOpen}>
  <Menu.Trigger>
    {#snippet child({ props })}
      <span class="contents" {...props}>
        <Button
          variant="ghost-light"
          size={buttonSizeMap[size]}
          tooltip={m.ui_viewSettings_trigger_tooltip()}
          tooltipSide="bottom"
          aria-label={m.ui_viewSettings_trigger_tooltip()}
          aria-expanded={dropdownOpen}
          class={className}
          data-testid="view-settings-trigger"
        >
          <Fa icon={faSliders} size="xs" />
        </Button>
      </span>
    {/snippet}
  </Menu.Trigger>
  <Menu.Content align="end" class="w-56 p-3!" aria-label={m.ui_dropdownMenu_ariaLabel()}>
    {#if showPreview}
      <Menu.CheckboxItem
        checked={previewEnabled}
        closeOnSelect={false}
        onCheckedChange={onTogglePreview}
        class="data-[state=checked]:bg-transparent"
      >
        {m.ui_viewSettings_markdownPreview_label()}
      </Menu.CheckboxItem>
    {/if}
    {#if showExpand}
      <Menu.CheckboxItem
        checked={expanded}
        closeOnSelect={false}
        onCheckedChange={onToggleExpand}
        class="data-[state=checked]:bg-transparent"
      >
        {m.ui_viewSettings_allFilesExpanded_label()}
      </Menu.CheckboxItem>
    {/if}
    {#if showFold}
      <Menu.CheckboxItem
        checked={foldEnabled}
        closeOnSelect={false}
        onCheckedChange={onToggleFold}
        class="data-[state=checked]:bg-transparent"
      >
        {m.ui_viewSettings_foldUnchanged_label()}
      </Menu.CheckboxItem>
    {/if}
    {#if showWrap}
      <Menu.CheckboxItem
        checked={wrapEnabled}
        closeOnSelect={false}
        onCheckedChange={onToggleWrap}
        class="data-[state=checked]:bg-transparent"
      >
        {m.ui_viewSettings_wrapLines_label()}
      </Menu.CheckboxItem>
    {/if}
    {#if showSplit}
      <Menu.CheckboxItem
        checked={splitEnabled}
        closeOnSelect={false}
        onCheckedChange={onToggleSplit}
        class="data-[state=checked]:bg-transparent"
      >
        {m.ui_viewSettings_splitView_label()}
      </Menu.CheckboxItem>
    {/if}
    {#if showDiff}
      <Menu.CheckboxItem
        checked={diffEnabled}
        closeOnSelect={false}
        onCheckedChange={onToggleDiff}
        class="data-[state=checked]:bg-transparent"
      >
        {m.ui_viewSettings_diffIndicators_label()}
      </Menu.CheckboxItem>
    {/if}
  </Menu.Content>
</Menu.Root>
