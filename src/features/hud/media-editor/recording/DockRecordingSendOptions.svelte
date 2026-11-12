<script lang="ts">
  import { m } from '$shared/paraglide/messages.js';
  import { Tooltip } from '$lib/components/ui/tooltip';
  import '$lib/styles/dock-tokens.css';
  import * as ToggleGroup from '$lib/components/ui/toggle-group';
  import { keepToggleSelected } from '$lib/components/settings/utils/keep-toggle-selected';
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

  let fullHelpOpen = $state(false);
  let highlightsHelpOpen = $state(false);

  function dismissHelp(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || event.isComposing || (!fullHelpOpen && !highlightsHelpOpen))
      return;
    // Dismiss this local help layer before the editor's Escape-to-close handler.
    event.preventDefault();
    fullHelpOpen = false;
    highlightsHelpOpen = false;
  }

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

<svelte:window onkeydowncapture={dismissHelp} />

<section class="options" data-send-options>
  <div class="group">
    <span class="label" id="send-video-label">{m.dock_captureEditor_video_label()}</span>
    <ToggleGroup.Root
      type="single"
      variant="outline"
      size="sm"
      class="shrink-0"
      aria-labelledby="send-video-label"
      disabled={!enabled}
      value={video}
      onValueChange={(value: string) => {
        if (value === 'full' || value === 'highlights')
          onChange({ video: value, voice: voiceChoice });
      }}
    >
      <Tooltip
        bind:open={fullHelpOpen}
        content={m.dock_captureEditor_videoFull_help()}
        contentClass="dock-chrome-tooltip"
      >
        <ToggleGroup.Item {...keepToggleSelected} value="full"
          >{m.dock_captureEditor_videoFull_label()}</ToggleGroup.Item
        >
      </Tooltip>
      <Tooltip
        bind:open={highlightsHelpOpen}
        content={highlights
          ? m.dock_captureEditor_videoHighlights_help()
          : m.dock_captureEditor_videoHighlights_disabled()}
        contentClass="dock-chrome-tooltip"
      >
        <ToggleGroup.Item
          {...keepToggleSelected}
          value="highlights"
          disabled={!enabled || !highlights}
          >{m.dock_captureEditor_videoHighlights_label()}</ToggleGroup.Item
        >
      </Tooltip>
    </ToggleGroup.Root>
  </div>
  <div class="group">
    <span class="label" id="send-voice-label">{m.dock_captureEditor_voice_label()}</span>
    <ToggleGroup.Root
      type="single"
      variant="outline"
      size="sm"
      class="shrink-0"
      aria-labelledby="send-voice-label"
      disabled={!enabled}
      value={voiceChoice}
      onValueChange={(value: string) => {
        if (value === 'audio' || value === 'transcript' || value === 'off')
          onChange({ video, voice: value });
      }}
    >
      <ToggleGroup.Item
        {...keepToggleSelected}
        value="audio"
        disabled={!enabled || !voice.audio.enabled}
        tooltip={voice.audio.reason ? reasons[voice.audio.reason]() : undefined}
        >{m.dock_captureEditor_voiceAudio_label()}</ToggleGroup.Item
      >
      <ToggleGroup.Item
        {...keepToggleSelected}
        value="transcript"
        disabled={!enabled || !voice.transcript.enabled}
        tooltip={voice.transcript.reason ? reasons[voice.transcript.reason]() : undefined}
        >{m.dock_captureEditor_voiceTranscript_label()}</ToggleGroup.Item
      >
      <ToggleGroup.Item {...keepToggleSelected} value="off"
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
    padding: 6px 4px 16px;
  }
  /* Like Settings: the label on the left, the compact control on the right. */
  .group {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .label {
    font-size: 12px;
    color: hsl(var(--muted-foreground));
  }
</style>
