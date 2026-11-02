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
  import { Button } from '$lib/components/ui/button';
  import { ToastCloseButton, ToastGlyph, toast, type ToastT } from '$lib/components/ui/toast';
  import { fly } from '$lib/motion';
  import { m } from '$shared/paraglide/messages.js';

  type ToastId = ToastT['id'];
  type ToastControl = NonNullable<ToastT['action']>;
  type ToastButton = Extract<ToastControl, { label: unknown }>;

  let { register }: { register: (element: HTMLElement) => () => void } = $props();

  /** Matches the app toast host's default when a caller sets no duration. */
  const DEFAULT_DURATION = 10_000;
  const shown = new Set<ToastId>();

  // Only unaddressed notifications belong to this window's single host; the
  // store keeps newest first, so the first one is the one the banner shows.
  const unaddressed = $derived(toast.getActiveToasts().filter((item) => !item.toasterId));
  const current = $derived(unaddressed[0]);
  const glyph = $derived.by(() => {
    const type = current?.type;
    if (type === 'success' || type === 'error' || type === 'warning' || type === 'loading')
      return type;
    return 'info';
  });

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
  // for the person (or a replacement). Hovering the banner pauses the countdown.
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

  function registerBanner(element: HTMLElement) {
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
        class="banner"
        class:error={item.type === 'error'}
        data-dock-notice
        data-type={item.type}
        role={item.type === 'error' ? 'alert' : 'status'}
        onpointerenter={() => (hovered = item.id)}
        onpointerleave={() => (hovered = null)}
        in:fly|global={{ tier: 'moderate', distance: 6 }}
        out:fly|global={{ tier: 'fast', distance: 6 }}
        {@attach registerBanner}
      >
        {#if item.component}
          {@const Custom = item.component}
          <div class="custom">
            <Custom {...item.componentProps} closeToast={() => close(item)} />
          </div>
        {:else}
          <ToastGlyph variant={glyph} />
          <p class="message">
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
              variant="ghost"
              size="compact"
              class="notice-action"
              onclick={(event: MouseEvent) => runControl(item, cancel, event)}
              >{cancel.label}</Button
            >
          {/if}
          {#if isButton(item.action)}
            {@const action = item.action}
            <Button
              variant="ghost"
              size="compact"
              class="notice-action"
              onclick={(event: MouseEvent) => runControl(item, action, event)}
              >{action.label}</Button
            >
          {/if}
          {#if item.dismissible !== false}
            <ToastCloseButton
              inline
              onclick={() => close(item)}
              ariaLabel={m.ui_toast_close_ariaLabel()}
            />
          {/if}
        {/if}
      </div>
    {/key}
  {/if}
</div>

<style>
  /* A zero-height rail at the composer's top edge: banners grow upward over the
     transcript, so the transcript never reflows when one appears or leaves. */
  .conversation-notifications {
    position: absolute;
    /* Inherits the composer lane's inset from the ChatContentLane that hosts it. */
    inset-inline: var(--chat-content-inset, 1rem);
    bottom: 0;
    height: 0;
    pointer-events: none;
    /* Above message hover actions (z-10), which otherwise cover the banner's action. */
    z-index: var(--layer-chrome);
  }
  .banner {
    position: absolute;
    inset-inline: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    min-height: var(--control-height-medium);
    padding: var(--space-1) var(--space-1) var(--space-1) var(--space-3);
    border-radius: var(--radius-large);
    background: hsl(var(--muted));
    color: hsl(var(--foreground));
    font-size: var(--text-body-size);
    line-height: var(--text-body-line-height);
    pointer-events: auto;
  }
  .banner.error .message {
    color: hsl(var(--danger));
  }
  .message {
    flex: 1;
    min-width: 0;
    margin: 0;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
    overflow-wrap: anywhere;
  }
  .description {
    color: hsl(var(--muted-foreground));
  }
  .description::before {
    content: ' ';
  }
  .custom {
    flex: 1;
    min-width: 0;
  }
  .banner :global(.notice-action) {
    flex: none;
    padding-inline: var(--space-2);
    font-weight: 500;
  }
</style>
