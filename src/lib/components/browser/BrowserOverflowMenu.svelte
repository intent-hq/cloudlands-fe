<script lang="ts">
  import Fa from 'svelte-fa';
  import {
    faArrowUpRightFromSquare,
    faCamera,
    faCode,
    faCopy,
    faCrosshairs,
    faRotate,
    faTerminal,
  } from '@fortawesome/free-solid-svg-icons';
  import KebabIcon from '$lib/components/icons/KebabIcon.svelte';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import * as Menu from '$lib/components/ui/menu';
  import { formatInteger } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    errorCount?: number;
    disabled?: boolean;
    onOpenExternal: () => void | Promise<void>;
    onCopyUrl: () => void | Promise<void>;
    onScreenshot: () => void | Promise<void>;
    onOpenConsole: () => void | Promise<void>;
    onOpenSource: () => void | Promise<void>;
    onOpenInspector: () => void | Promise<void>;
    onReloadWithoutCache: () => void | Promise<void>;
  }

  let {
    errorCount = 0,
    disabled = false,
    onOpenExternal,
    onCopyUrl,
    onScreenshot,
    onOpenConsole,
    onOpenSource,
    onOpenInspector,
    onReloadWithoutCache,
  }: Props = $props();

  const triggerLabel = $derived(
    errorCount > 0
      ? m.browser_overflow_triggerWithErrors_ariaLabel({ count: formatInteger(errorCount) })
      : m.browser_overflow_trigger_ariaLabel(),
  );
</script>

<Menu.Root>
  <Menu.Trigger>
    {#snippet child({ props })}
      <Button
        {...props}
        variant="ghost-light"
        size="icon-xs"
        class="relative"
        {disabled}
        tooltip={m.browser_overflow_trigger_tooltip()}
        tooltipSide="bottom"
        aria-label={triggerLabel}
        data-testid="browser-overflow-trigger"
      >
        <KebabIcon class="size-3.5" />
        {#if errorCount > 0}
          <Badge
            variant="destructive"
            class="absolute -right-1.5 -top-1.5 h-4 min-w-4 px-1 text-[10px] leading-none"
            data-testid="browser-console-error-badge"
          >
            {errorCount > 9 ? '9+' : formatInteger(errorCount)}
          </Badge>
        {/if}
      </Button>
    {/snippet}
  </Menu.Trigger>
  <Menu.Content align="end" class="w-56">
    <Menu.Item onSelect={() => void onOpenExternal()}>
      <Fa icon={faArrowUpRightFromSquare} size="xs" class="w-4 text-muted-foreground" />
      {m.browser_overflow_openExternal_label()}
    </Menu.Item>
    <Menu.Item onSelect={() => void onCopyUrl()}>
      <Fa icon={faCopy} size="xs" class="w-4 text-muted-foreground" />
      {m.browser_overflow_copyUrl_label()}
    </Menu.Item>
    <Menu.Separator />
    <Menu.Item onSelect={() => void onScreenshot()}>
      <Fa icon={faCamera} size="xs" class="w-4 text-muted-foreground" />
      {m.browser_overflow_screenshot_label()}
    </Menu.Item>
    <Menu.Item onSelect={() => void onOpenConsole()}>
      <Fa icon={faTerminal} size="xs" class="w-4 text-muted-foreground" />
      {m.browser_overflow_console_label()}
    </Menu.Item>
    <Menu.Item onSelect={() => void onOpenSource()}>
      <Fa icon={faCode} size="xs" class="w-4 text-muted-foreground" />
      {m.browser_overflow_source_label()}
    </Menu.Item>
    <Menu.Item onSelect={() => void onOpenInspector()}>
      <Fa icon={faCrosshairs} size="xs" class="w-4 text-muted-foreground" />
      <span class="min-w-0 flex-1">{m.browser_overflow_inspector_label()}</span>
      <kbd class="type-caption ml-5 text-muted-foreground" aria-hidden="true">⌘⌥I</kbd>
    </Menu.Item>
    <Menu.Separator />
    <Menu.Item onSelect={() => void onReloadWithoutCache()}>
      <Fa icon={faRotate} size="xs" class="w-4 text-muted-foreground" />
      {m.browser_overflow_reloadWithoutCache_label()}
    </Menu.Item>
  </Menu.Content>
</Menu.Root>
