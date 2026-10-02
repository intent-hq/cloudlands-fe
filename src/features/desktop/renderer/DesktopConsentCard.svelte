<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { m } from '$shared/paraglide/messages.js';
  import type { DesktopPermissionRequest, DesktopPermissionDecision } from '$shared/types/desktop';
  let {
    request,
    pending = false,
    onDecision,
  }: {
    request: DesktopPermissionRequest;
    pending?: boolean;
    onDecision: (decision: DesktopPermissionDecision) => void;
  } = $props();
</script>

<div class="flex min-w-0 flex-col gap-3" role="group" aria-label={m.desktop_consent_title()}>
  <p class="font-medium break-words">
    {m.desktop_consent_request({ agent: request.agentName, computer: request.computerName })}
  </p>
  <p class="text-sm text-muted-foreground">{m.desktop_consent_description()}</p>
  {#if pending}
    <p role="status" class="text-sm">{m.desktop_consent_pending()}</p>
  {/if}
  <div class="flex flex-wrap gap-2">
    <Button
      size="compact"
      variant="primary"
      disabled={pending}
      onclick={() => onDecision('allow_once')}>{m.desktop_consent_once()}</Button
    >
    <Button
      size="compact"
      variant="outline"
      disabled={pending}
      onclick={() => onDecision('allow_future')}>{m.desktop_consent_future()}</Button
    >
    <Button size="compact" variant="ghost" disabled={pending} onclick={() => onDecision('deny')}
      >{m.desktop_consent_deny()}</Button
    >
  </div>
</div>
