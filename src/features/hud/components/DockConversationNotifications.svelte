<script lang="ts" module>
  import { getContext, setContext } from 'svelte';

  /** The conversation surface owns registration; the panel decides where the banner sits. */
  export interface DockConversationNoticeHost {
    /** Null while the surface is inactive or its pointer owner is not ready. */
    readonly register: ((element: HTMLElement) => () => void) | null;
    /** A new key remounts the banner, dismissing what the previous owner showed. */
    readonly key: string;
    /** Whether the conversation surface is the active, visible one. */
    readonly active: boolean;
  }

  const NOTICE_HOST = Symbol('dock-conversation-notices');

  export function setDockConversationNoticeHost(host: DockConversationNoticeHost): void {
    setContext(NOTICE_HOST, host);
  }

  export function getDockConversationNoticeHost(): DockConversationNoticeHost | undefined {
    return getContext<DockConversationNoticeHost | undefined>(NOTICE_HOST);
  }
</script>

<script lang="ts">
  import { onDestroy } from 'svelte';
  import Fa from 'svelte-fa';
  import { faXmark } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import { toast, type ToastT } from '$lib/components/ui/toast';
  import { m } from '$shared/paraglide/messages.js';

  type ToastId = ToastT['id'];
  type ToastControl = NonNullable<ToastT['action']>;
  type ToastButton = Extract<ToastControl, { label: unknown }>;

  let { register }: { register: (element: HTMLElement) => () => void } = $props();

  /** Matches the app toast host's default when a caller sets no duration. */
  const DEFAULT_DURATION = 10_000;
  const shown = new Set<ToastId>();

  // No toasts in the dock: notifications raised here render as an ordinary status
  // line in the composer (text plus plain buttons), never a floating banner. Only
  // failures (error, warning) and notices whose button is the only way to act
  // (e.g. Undo) are kept. Plain info, success and progress notices are cleared.
  const bannerWorthy = (item: ToastT): boolean =>
    item.type === 'error' ||
    item.type === 'warning' ||
    isButton(item.action) ||
    isButton(item.cancel);
  // Only unaddressed notifications belong to this window's single host; the
  // store keeps newest first, so the first one is the one the banner shows.
  const unaddressed = $derived(
    toast.getActiveToasts().filter((item) => !item.toasterId && bannerWorthy(item)),
  );
  $effect(() => {
    for (const item of toast.getActiveToasts())
      if (!item.toasterId && !bannerWorthy(item)) toast.dismiss(item.id);
  });
  const current = $derived(unaddressed[0]);
  function isButton(control: ToastT['action']): control is ToastButton {
    return !!control && typeof control === 'object' && 'label' in control && 'onClick' in control;
  }

  function close(item: ToastT): void {
    toast.dismiss(item.id);
    item.onDismiss?.(item);
  }

  function runControl(item: ToastT, control: ToastButton, event: MouseEvent): void {
    control.onClick(event as MouseEvent & { currentTarget: EventTarget & HTMLButtonElement });
    if (!event.defaultPrevented) close(item);
  }

  // The newest notification replaces older ones instead of queueing behind them.
  $effect(() => {
    const [newest, ...older] = unaddressed;
    if (newest) shown.add(newest.id);
    for (const item of older) close(item);
  });

  // Keyed by the store object: an update replaces it, which restarts the lifetime.
  const remainingFor = new WeakMap<ToastT, number>();
  let hovered = $state<ToastId | null>(null);

  // Success and info keep their configured lifetimes; errors and progress wait
  // for the person (or a replacement). Hovering the status pauses the countdown.
  $effect(() => {
    const item = current;
    if (!item || item.type === 'error' || item.type === 'loading') return;
    const duration = item.duration ?? DEFAULT_DURATION;
    if (!Number.isFinite(duration) || hovered === item.id) return;
    const started = Date.now();
    const remaining = remainingFor.get(item) ?? duration;
    const timer = setTimeout(() => {
      remainingFor.delete(item);
      toast.dismiss(item.id);
      item.onAutoClose?.(item);
    }, remaining);
    return () => {
      clearTimeout(timer);
      remainingFor.set(item, Math.max(0, remaining - (Date.now() - started)));
    };
  });

  function registerNotice(element: HTMLElement) {
    return register(element);
  }

  onDestroy(() => {
    for (const item of toast.getActiveToasts()) {
      if (!item.toasterId && shown.has(item.id)) toast.dismiss(item.id);
    }
    shown.clear();
  });
</script>

<div
  class="conversation-notifications"
  data-dock-conversation-notifications
  role="region"
  aria-label={m.ui_toast_notifications_ariaLabel()}
>
  {#if current}
    {@const item = current}
    {#key item.id}
      <div
        class="notice"
        class:error={item.type === 'error'}
        data-dock-notice
        data-type={item.type}
        role={item.type === 'error' ? 'alert' : 'status'}
        onpointerenter={() => (hovered = item.id)}
        onpointerleave={() => (hovered = null)}
        {@attach registerNotice}
      >
        {#if item.component}
          {@const Custom = item.component}
          <div class="custom">
            <Custom {...item.componentProps} closeToast={() => close(item)} />
          </div>
        {:else}
          <p class="message type-caption">
            {#if typeof item.title === 'string'}
              <span data-dock-notice-title>{item.title}</span>
            {:else if item.title}
              {@const Title = item.title}
              <Title {...item.componentProps} />
            {/if}
            {#if typeof item.description === 'string'}
              <span class="description">{item.description}</span>
            {:else if item.description}
              {@const Description = item.description}
              <span class="description"><Description {...item.componentProps} /></span>
            {/if}
          </p>
          {#if isButton(item.cancel)}
            {@const cancel = item.cancel}
            <Button
              variant="outline"
              size="sm"
              onclick={(event: MouseEvent) => runControl(item, cancel, event)}
              >{cancel.label}</Button
            >
          {/if}
          {#if isButton(item.action)}
            {@const action = item.action}
            <Button
              variant="outline"
              size="sm"
              onclick={(event: MouseEvent) => runControl(item, action, event)}
              >{action.label}</Button
            >
          {/if}
          {#if item.dismissible !== false}
            <Button
              variant="ghost"
              size="icon-sm"
              onclick={() => close(item)}
              aria-label={m.ui_toast_close_ariaLabel()}
              tooltipContentClass="dock-chrome-tooltip"
              tooltip={m.ui_toast_close_ariaLabel()}><Fa icon={faXmark} /></Button
            >
          {/if}
        {/if}
      </div>
    {/key}
  {/if}
</div>

<style>
  /* An ordinary status line in the composer lane, in layout like the send error:
     no surface, glyph or motion of its own. */
  .notice {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    min-width: 0;
    margin-bottom: var(--space-2);
  }
  .message {
    flex: 1;
    min-width: 0;
    margin: 0;
    padding-block: var(--space-1);
    color: hsl(var(--muted-foreground));
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    overflow: hidden;
    overflow-wrap: anywhere;
  }
  .notice.error .message {
    color: hsl(var(--danger));
  }
  .description::before {
    content: ' ';
  }
  .custom {
    flex: 1;
    min-width: 0;
  }
</style>
