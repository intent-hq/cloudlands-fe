<script lang="ts">
  import { m } from '$shared/paraglide/messages.js';
  import * as ToggleGroup from '$lib/components/ui/toggle-group';
  import {
    canUseHighlights,
    voiceOptions,
    type DockMediaChoice,
    type DockMediaEdit,
    type DockMediaSource,
    type DockMediaTranscript,
  } from '$shared/dock-media-edit';

  /**
   * What the agent receives (Capture and recording editor spec, "What gets sent"):
   * Video (Full or Highlights) and Voice (Audio, Transcript or Off), each a segmented
   * control the width of the sidebar. Which options are possible comes from the shared
   * model; `enabled` is false until sending honors the choice, and then nothing changes.
   */
  let {
    edit,
    source,
    transcript,
    enabled,
    onChange,
  }: {
    /** Null for a recording that can only be played: shown, nothing chosen differently. */
    edit: DockMediaEdit | null;
    source: DockMediaSource | null;
    transcript: DockMediaTranscript | null;
    enabled: boolean;
    onChange: (choice: DockMediaChoice) => void;
  } = $props();

  const highlights = $derived(edit ? canUseHighlights(edit) : false);
  const voice = $derived(
    source
      ? voiceOptions(source, transcript)
      : {
          audio: { enabled: false, reason: null },
          transcript: { enabled: false, reason: null },
          off: { enabled: true, reason: null },
        },
  );
  // A recording that can only be played goes as it is: the whole video, no transcript.
  const video = $derived(edit?.video ?? 'full');
  const voiceChoice = $derived(edit?.voice ?? 'off');
  const reasons = {
    'audio-unavailable': () => m.dock_captureEditor_voiceAudio_unavailable(),
    'transcript-pending': () => m.dock_captureEditor_voiceTranscript_pending(),
    'transcript-unavailable': () => m.dock_captureEditor_voiceTranscript_unavailable(),
  } as const;
</script>

<section class="options" data-send-options>
  <div class="group">
    <span class="label" id="send-video-label">{m.dock_captureEditor_video_label()}</span>
    <ToggleGroup.Root
      type="single"
      variant="flat"
      class="send-choice w-full"
      aria-labelledby="send-video-label"
      disabled={!enabled}
      value={video}
      onValueChange={(value: string) => {
        if (value === 'full' || value === 'highlights')
          onChange({ video: value, voice: voiceChoice });
      }}
    >
      <ToggleGroup.Item value="full" class="flex-1"
        >{m.dock_captureEditor_videoFull_label()}</ToggleGroup.Item
      >
      <ToggleGroup.Item
        value="highlights"
        class="flex-1"
        disabled={!enabled || !highlights}
        tooltip={highlights ? undefined : m.dock_captureEditor_videoHighlights_disabled()}
        >{m.dock_captureEditor_videoHighlights_label()}</ToggleGroup.Item
      >
    </ToggleGroup.Root>
  </div>
  <div class="group">
    <span class="label" id="send-voice-label">{m.dock_captureEditor_voice_label()}</span>
    <ToggleGroup.Root
      type="single"
      variant="flat"
      class="send-choice w-full"
      aria-labelledby="send-voice-label"
      disabled={!enabled}
      value={voiceChoice}
      onValueChange={(value: string) => {
        if (value === 'audio' || value === 'transcript' || value === 'off')
          onChange({ video, voice: value });
      }}
    >
      <ToggleGroup.Item
        value="audio"
        class="flex-1"
        disabled={!enabled || !voice.audio.enabled}
        tooltip={voice.audio.reason ? reasons[voice.audio.reason]() : undefined}
        >{m.dock_captureEditor_voiceAudio_label()}</ToggleGroup.Item
      >
      <ToggleGroup.Item
        value="transcript"
        class="flex-1"
        disabled={!enabled || !voice.transcript.enabled}
        tooltip={voice.transcript.reason ? reasons[voice.transcript.reason]() : undefined}
        >{m.dock_captureEditor_voiceTranscript_label()}</ToggleGroup.Item
      >
      <ToggleGroup.Item value="off" class="flex-1"
        >{m.dock_captureEditor_voiceOff_label()}</ToggleGroup.Item
      >
    </ToggleGroup.Root>
  </div>
</section>

<style>
  .options {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 14px 16px;
    border-bottom: 1px solid hsl(var(--border));
  }
  .group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .label {
    font-size: 11px;
    color: hsl(var(--muted-foreground));
  }
  /*
   * Settings' segmented control (outline, small), with the chosen option always shown,
   * not only on hover: the app's selected fill with a hairline edge, in light and dark.
   */
  .options :global(.send-choice) {
    border: 1px solid hsl(var(--border));
    background: transparent;
    box-shadow: none;
  }
  .options :global(.send-choice [data-state='on']) {
    background: hsl(var(--selected));
    color: hsl(var(--foreground));
    box-shadow: inset 0 0 0 1px hsl(var(--border));
  }
</style>
