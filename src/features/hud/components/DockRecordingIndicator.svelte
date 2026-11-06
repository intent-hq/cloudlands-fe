<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import StopIcon from 'phosphor-svelte/lib/StopIcon';
  import { m } from '$shared/paraglide/messages.js';
  import { sharedTimeManager } from '$lib/utils/shared-time-manager.svelte';
  import { dockRecordingElapsedMs } from '$shared/dock-annotation';
  import { formatDockElapsed } from '$features/hud/composer/dock-annotation-bar-media';
  import type { DockRecordingIndicator } from '$features/hud/utils/dock-recording-indicator';
  let {
    recording,
    stopping = false,
    vertical = false,
    onOpen,
    onStop,
  }: {
    recording: DockRecordingIndicator;
    stopping?: boolean;
    vertical?: boolean;
    onOpen: () => void;
    onStop?: () => void;
  } = $props();
  let now = $state(Date.now());
  $effect(() => {
    const start = recording.startedAt,
      paused = recording.pausedAt;
    now = Date.now();
    if (paused !== null) return;
    return sharedTimeManager.subscribe(new Date(start), () => (now = Date.now()), 'second');
  });
  const elapsed = $derived(formatDockElapsed(dockRecordingElapsedMs(recording, now)));
  const status = $derived(
    recording.pausedAt !== null
      ? m.dock_recordingToolbar_status_paused()
      : m.dock_composer_recording_status(),
  );
</script>

<div class="recording-indicator" class:vertical data-dock-recording-indicator>
  <Button
    variant="ghost"
    size="compact"
    class="recording-time"
    onclick={onOpen}
    aria-label={m.dock_recordingIndicator_open({ status, elapsed })}
    tooltip={m.dock_recordingIndicator_open({ status, elapsed })}
  >
    <span class="recording-dot" class:paused={recording.pausedAt !== null} aria-hidden="true"
    ></span>
    <span class="elapsed" data-dock-recording-elapsed>{elapsed}</span>
  </Button>
  <Button
    variant="ghost"
    size="icon-compact"
    class="recording-stop"
    disabled={stopping || !onStop}
    aria-label={m.dock_composer_stopRecording_tooltip()}
    tooltip={m.dock_composer_stopRecording_tooltip()}
    aria-busy={stopping}
    onclick={() => onStop?.()}><StopIcon size={12} weight="fill" /></Button
  >
</div>

<style>
  .recording-indicator {
    display: flex;
    align-items: center;
    gap: 2px;
    white-space: nowrap;
  }
  .recording-indicator :global(.recording-time) {
    gap: 5px;
    padding-inline: 4px;
  }
  .recording-dot {
    width: 6px;
    height: 6px;
    flex: none;
    border-radius: 50%;
    background: hsl(var(--danger));
  }
  .recording-dot.paused {
    background: hsl(var(--muted-foreground));
  }
  .elapsed {
    font-variant-numeric: tabular-nums;
    font-size: 11px;
    line-height: 1;
  }
  .vertical {
    flex-direction: column;
    gap: 4px;
  }
  .vertical :global(.recording-time) {
    flex-direction: column;
    gap: 4px;
    min-height: 30px;
    padding: 2px 0;
  }
</style>
