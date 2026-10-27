<script lang="ts">
  import CheckCircleIcon from 'phosphor-svelte/lib/CheckCircleIcon';
  import CircleIcon from 'phosphor-svelte/lib/CircleIcon';
  import WarningCircleIcon from 'phosphor-svelte/lib/WarningCircleIcon';
  import { m } from '$shared/paraglide/messages.js';
  import type { DesktopOsChecklist } from '$shared/types/desktop';
  let { checklist }: { checklist: DesktopOsChecklist } = $props();
  type ItemState = 'done' | 'waiting' | 'failed';
  const items = $derived.by(() => {
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
