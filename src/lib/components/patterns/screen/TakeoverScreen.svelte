<script lang="ts">
  import { animatedHeight } from '$lib/motion';
  import { cn } from '$lib/utils';
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import Screen from './Screen.svelte';
  import ScreenBody from './ScreenBody.svelte';
  import ScreenFooter from './ScreenFooter.svelte';
  import ScreenHeader from './ScreenHeader.svelte';

  type DataAttributes = Record<`data-${string}`, string | number | boolean | undefined>;

  interface Props extends Omit<HTMLAttributes<HTMLElement>, 'title' | 'children'> {
    ref?: HTMLElement | null;
    title: Snippet;
    description?: Snippet;
    counter?: Snippet;
    leading?: Snippet;
    actions?: Snippet;
    children: Snippet;
    destructive?: Snippet;
    secondary?: Snippet;
    primary: Snippet;
    hint?: string;
    headerClass?: string;
    bodyClass?: string;
    footerClass?: string;
    headerAttributes?: DataAttributes;
    bodyRegionAttributes?: DataAttributes;
    footerAttributes?: DataAttributes;
    class?: string;
  }

  let {
    ref = $bindable(null),
    title,
    description,
    counter,
    leading,
    actions,
    children,
    destructive,
    secondary,
    primary,
    hint,
    headerClass,
    bodyClass,
    footerClass,
    headerAttributes,
    bodyRegionAttributes,
    footerAttributes,
    class: className,
    ...restProps
  }: Props = $props();
</script>

<div data-slot="takeover-screen" class="flex min-h-0 w-full min-w-0 flex-col">
  <Screen bind:ref class={cn('min-h-0 flex-1 overflow-hidden', className)} {...restProps}>
    <ScreenHeader
      {title}
      {description}
      {counter}
      {leading}
      {actions}
      class={headerClass}
      {...headerAttributes}
    />
    <div
      class="min-h-0 flex-1"
      use:animatedHeight={true}
      data-slot="takeover-screen-body"
      {...bodyRegionAttributes}
    >
      <ScreenBody class={bodyClass}>{@render children()}</ScreenBody>
    </div>
    <ScreenFooter
      {destructive}
      {secondary}
      {primary}
      {hint}
      class={footerClass}
      {...footerAttributes}
    />
  </Screen>
</div>
