<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { m } from '$shared/paraglide/messages.js';
  import CheckCircleIcon from 'phosphor-svelte/lib/CheckCircleIcon';
  import CircleIcon from 'phosphor-svelte/lib/CircleIcon';
  import WarningCircleIcon from 'phosphor-svelte/lib/WarningCircleIcon';
  import type {
    DesktopOsChecklist,
    DesktopPermissionRequest,
    DesktopPermissionDecision,
  } from '$shared/types/desktop';
  let {
    request,
    pending = false,
    settingUp = false,
    guidance,
    checklist,
    onDecision,
  }: {
    request: DesktopPermissionRequest;
    pending?: boolean;
    settingUp?: boolean;
    guidance?: string;
    checklist?: DesktopOsChecklist;
    onDecision: (decision: DesktopPermissionDecision) => void;
  } = $props();
  type ItemState = 'done' | 'waiting' | 'failed';
  const items = $derived.by(() => {
    if (!checklist) return [];
    const granted = (ok: boolean) => ({
      state: (ok ? 'done' : 'waiting') as ItemState,
      status: ok ? m.desktop_os_checklist_allowed() : m.desktop_os_checklist_missing(),
    });
    const capture = (): { state: ItemState; status: string } => {
      if (!checklist.accessibility || !checklist.screenRecording)
        return { state: 'waiting', status: m.desktop_os_checklist_blocked() };
      if (checklist.screenCapture === 'ready')
        return { state: 'done', status: m.desktop_os_checklist_ready() };
      if (checklist.screenCapture === 'pending')
        return { state: 'waiting', status: m.desktop_os_checklist_checking() };
      return { state: 'failed', status: m.desktop_os_checklist_unconfirmed() };
    };
    return [
      { label: m.desktop_os_checklist_accessibility(), ...granted(checklist.accessibility) },
      { label: m.desktop_os_checklist_screenRecording(), ...granted(checklist.screenRecording) },
      { label: m.desktop_os_checklist_screenCapture(), ...capture() },
    ];
  });
</script>

<div
  class="flex max-h-[min(calc(100dvh-8rem),calc(var(--toast-max-height,100dvh)-2rem))] min-h-0 min-w-0 flex-col gap-3"
  role="group"
  aria-label={m.desktop_consent_title()}
>
  <div
    class="min-h-0 space-y-3 overflow-y-auto break-words"
    role="region"
    aria-label={m.desktop_consent_title()}
    tabindex="0"
  >
    <p class="font-medium break-words">
      {m.desktop_consent_request({ agent: request.agentName, computer: request.computerName })}
    </p>
    <p class="text-sm text-muted-foreground">{m.desktop_consent_description()}</p>
    {#if request.claimsPrimary}
      <p class="text-sm text-muted-foreground">
        {m.desktop_consent_claimPrimary({ computer: request.computerName })}
      </p>
    {/if}
    {#if items.length}
      <ul class="space-y-1 text-sm" aria-label={m.desktop_os_checklist_title()}>
        {#each items as item (item.label)}
          <li class="flex items-center gap-2" data-state={item.state}>
            {#if item.state === 'done'}
              <CheckCircleIcon class="size-4 shrink-0 text-success" aria-hidden="true" />
            {:else if item.state === 'failed'}
              <WarningCircleIcon class="size-4 shrink-0 text-danger" aria-hidden="true" />
            {:else}
              <CircleIcon class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            {/if}
            <span class="min-w-0 flex-1 break-words">{item.label}</span>
            <span class="shrink-0 text-muted-foreground">{item.status}</span>
          </li>
        {/each}
      </ul>
    {/if}
    {#if guidance}
      <p role="status" class="text-sm">{guidance}</p>
    {/if}
    {#if pending && !settingUp}
      <p role="status" class="text-sm">{m.desktop_consent_pending()}</p>
    {/if}
  </div>
  <div class="flex shrink-0 flex-wrap gap-2">
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
    <Button
      size="compact"
      variant="ghost"
      disabled={pending && !settingUp}
      onclick={() => onDecision('deny')}>{m.desktop_consent_deny()}</Button
    >
  </div>
</div>
