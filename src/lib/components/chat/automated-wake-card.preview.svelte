<script lang="ts" module>
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import type { AutomatedWakePresentation } from './automated-wake-presentation';

  export interface AutomatedWakeCardPreviewProps {
    presentation: AutomatedWakePresentation;
  }

  const hookPresentation = (displayName: string): AutomatedWakePresentation => ({
    kind: 'hook',
    attribution: {
      hookId: 'preview-hook',
      displayName,
      rawName: displayName,
      reason: 'dispatched',
      hookStillActive: false,
    },
    bodyText: 'The preview hook woke the agent.',
    queueInfo: null,
    state: 'retired',
  });

  export const preview = definePreview<AutomatedWakeCardPreviewProps>({
    id: 'automated-wake-card',
    title: 'Chat automated wake card',
    defaultState: 'long-retired',
    states: {
      'long-retired': { props: { presentation: hookPresentation('Open workspace tab preview') } },
      'short-retired': { props: { presentation: hookPresentation('CI watch') } },
    },
  });
</script>

<script lang="ts">
  import AutomatedWakeCardHeader from './AutomatedWakeCardHeader.svelte';
  import {
    SUBSCRIPTION_CARD_CONTAINMENT_CLASS,
    SUBSCRIPTION_CARD_SURFACE_CLASS,
  } from './subscription-disclosure';

  let { presentation }: AutomatedWakeCardPreviewProps = $props();
  let expanded = $state(false);
  const controlsId = 'automated-wake-card-preview-details';
</script>

<section
  class="{SUBSCRIPTION_CARD_CONTAINMENT_CLASS} {SUBSCRIPTION_CARD_SURFACE_CLASS}"
  data-testid="automated-wake-card-preview"
>
  <AutomatedWakeCardHeader
    {presentation}
    {expanded}
    {controlsId}
    ontoggle={() => (expanded = !expanded)}
  />
  {#if expanded}
    <div id={controlsId} class="border-t border-border px-3 py-2 text-sm text-foreground">
      {presentation.bodyText}
    </div>
  {/if}
</section>
