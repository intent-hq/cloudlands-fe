<script lang="ts">
  import Fa from 'svelte-fa';
  import { faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    /** The card's agent (`''` = General, which has no pin of its own). */
    agentName: string;
    /** Display name of the turned-off provider. */
    providerName: string;
    /** workspace.create refused the provider, rather than the card detecting it first. */
    failed?: boolean;
    onopensettings: () => void;
  }

  let { agentName, providerName, failed = false, onopensettings }: Props = $props();

  const uid = $props.id();
  const descriptionId = `${uid}-description`;
</script>

<!-- The card's Model row above picks another provider's model; this explains why it's needed. -->
<div
  class="space-y-2.5 rounded-md border border-warning/30 bg-warning/10 px-3 py-2.5"
  data-testid="proposal-provider-alert"
  role="group"
  aria-describedby={descriptionId}
>
  <div class="flex items-start gap-2">
    <Fa icon={faTriangleExclamation} class="mt-0.5 size-3.5 shrink-0 text-warning-ink" />
    <p
      id={descriptionId}
      class="type-caption text-foreground"
      role="status"
      aria-live={failed ? 'assertive' : 'polite'}
    >
      {agentName
        ? m.chat_proposalCard_providerOff_description({ agent: agentName, provider: providerName })
        : m.chat_proposalCard_providerOffNoAgent_description({ provider: providerName })}
    </p>
  </div>
  <div class="flex flex-wrap items-center gap-2 pl-5.5">
    <Button
      variant="ghost"
      size="sm"
      onclick={onopensettings}
      data-testid="proposal-provider-alert-settings"
    >
      {m.chat_proposalCard_providerOffSettings_label()}
    </Button>
  </div>
</div>
