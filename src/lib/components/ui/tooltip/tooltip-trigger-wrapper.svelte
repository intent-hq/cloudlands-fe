<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  type TriggerProps = HTMLAttributes<HTMLElement> & {
    disabled?: boolean | null;
    type?: string;
  };

  let {
    triggerProps,
    children,
  }: {
    triggerProps: TriggerProps;
    children?: Snippet;
  } = $props();

  const interactiveSelector = [
    'button',
    'a[href]',
    'input:not([type="hidden"])',
    'select',
    'textarea',
    '[role="button"]',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');
  const forwardedAttributes = [
    'aria-describedby',
    'data-state',
    'data-disabled',
    'data-delay-duration',
    'data-tooltip-trigger',
  ] as const;

  let wrapper: HTMLSpanElement | null = $state(null);
  let hasInteractiveChild = $state(false);
  // Menu content manages focus itself (roving focus visits only menu items and
  // Tab is intercepted), so a wrapper rendered inside menu content must not
  // become a nested interactive element: skip role="button" and the tab stop.
  let inMenuContent = $state(false);
  let forwardedTargets: HTMLElement[] = [];
  const originalAttributes = new WeakMap<HTMLElement, Map<string, string | null>>();

  const wrapperProps = $derived.by(() => {
    const {
      disabled: _disabled,
      type: _type,
      tabindex: _tabindex,
      class: _class,
      'aria-describedby': _ariaDescribedby,
      'data-state': _dataState,
      'data-disabled': _dataDisabled,
      'data-delay-duration': _dataDelayDuration,
      'data-tooltip-trigger': _dataTooltipTrigger,
      ...rest
    } = triggerProps;
    return rest;
  });

  function originalAttribute(target: HTMLElement, attribute: string): string | null {
    let originals = originalAttributes.get(target);
    if (!originals) {
      originals = new Map();
      originalAttributes.set(target, originals);
    }
    if (!originals.has(attribute)) originals.set(attribute, target.getAttribute(attribute));
    return originals.get(attribute) ?? null;
  }

  function restoreForwardedAttributes(target: HTMLElement) {
    for (const attribute of forwardedAttributes) {
      const original = originalAttribute(target, attribute);
      if (attribute === 'data-state' && original !== null) continue;
      if (original === null) target.removeAttribute(attribute);
      else target.setAttribute(attribute, original);
    }
  }

  function syncForwardedAttributes(target: HTMLElement) {
    for (const attribute of forwardedAttributes) {
      const original = originalAttribute(target, attribute);
      if (attribute === 'data-state' && original !== null) continue;
      const value = triggerProps[attribute];
      if (value === undefined || value === null || value === false) {
        if (original === null) target.removeAttribute(attribute);
        else target.setAttribute(attribute, original);
        continue;
      }
      const forwarded = value === true ? '' : String(value);
      target.setAttribute(
        attribute,
        attribute === 'aria-describedby' && original ? `${original} ${forwarded}` : forwarded,
      );
    }
  }

  $effect(() => {
    if (!wrapper) return;
    inMenuContent = wrapper.closest('[role="menu"], [role="menuitem"]') !== null;
    const targets = Array.from(wrapper.querySelectorAll<HTMLElement>(interactiveSelector));
    for (const target of forwardedTargets) {
      if (!targets.includes(target)) restoreForwardedAttributes(target);
    }
    forwardedTargets = targets;
    hasInteractiveChild = targets.length > 0;
    for (const target of targets) syncForwardedAttributes(target);
  });

  function handleFocusIn(event: FocusEvent & { currentTarget: EventTarget & HTMLSpanElement }) {
    if (!hasInteractiveChild || event.target === wrapper) return;
    triggerProps.onfocus?.(event);
  }

  function handleFocusOut(event: FocusEvent & { currentTarget: EventTarget & HTMLSpanElement }) {
    if (!hasInteractiveChild || wrapper?.contains(event.relatedTarget as Node | null)) return;
    triggerProps.onblur?.(event);
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<span
  bind:this={wrapper}
  {...wrapperProps}
  class={triggerProps.class}
  role={hasInteractiveChild || inMenuContent ? undefined : 'button'}
  tabindex={hasInteractiveChild ? -1 : inMenuContent ? undefined : triggerProps.tabindex}
  aria-disabled={hasInteractiveChild || inMenuContent
    ? undefined
    : triggerProps.disabled || undefined}
  aria-describedby={hasInteractiveChild ? undefined : triggerProps['aria-describedby']}
  data-state={hasInteractiveChild ? undefined : triggerProps['data-state']}
  data-disabled={hasInteractiveChild ? undefined : triggerProps['data-disabled']}
  data-delay-duration={hasInteractiveChild ? undefined : triggerProps['data-delay-duration']}
  data-tooltip-trigger={hasInteractiveChild ? undefined : triggerProps['data-tooltip-trigger']}
  onfocusin={handleFocusIn}
  onfocusout={handleFocusOut}
>
  {@render children?.()}
</span>
