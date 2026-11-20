<script lang="ts" module>
  import { definePreview } from '$lib/component-catalog/preview-definition';

  type Voice = 'speaking' | 'quiet' | 'silent';
  interface PreviewProps {
    voice?: Voice;
  }

  export const preview = definePreview<PreviewProps>({
    id: 'dictation-meter',
    title: 'Dictation meter',
    defaultState: 'speaking',
    states: {
      speaking: { props: { voice: 'speaking' } },
      quiet: { props: { voice: 'quiet' } },
      silent: { props: { voice: 'silent' } },
    },
  });
</script>

<script lang="ts">
  import { onDestroy } from 'svelte';
  import { store } from '$store/renderer/store';
  import { catalogNow } from '$lib/component-catalog/catalog-clock';
  import {
    pttInputLevelsChanged,
    pttRecordingStarted,
    pttRecordingStopped,
  } from '$store/renderer/slices/hardware-console/hardware-console-slice';
  import ActionKeyHud from '$features/hardware-console/actions/ActionKeyHud.svelte';
  import DictationStopButton from './DictationStopButton.svelte';

  let { voice = 'speaking' }: PreviewProps = $props();

  const gain = $derived(voice === 'speaking' ? 1 : voice === 'quiet' ? 0.35 : 0);

  store.dispatch(pttRecordingStopped());
  store.dispatch(pttRecordingStarted({ source: 'key', startedAt: catalogNow() - 7_000 }));

  // Deterministic synthetic speech: a syllable envelope over a falling spectrum.
  let tick = 0;
  const timer = setInterval(() => {
    tick += 1;
    const syllable = Math.max(0, Math.sin(tick * 0.35) * 0.6 + Math.sin(tick * 0.14 + 1) * 0.5 + 0.2);
    store.dispatch(
      pttInputLevelsChanged(
        Array.from({ length: 5 }, (_, band) =>
          Math.min(1, gain * syllable * (1 - band * 0.12) * (0.75 + 0.25 * Math.sin(tick + band * 1.7))),
        ),
      ),
    );
  }, 66);

  onDestroy(() => {
    clearInterval(timer);
    store.dispatch(pttRecordingStopped());
  });
</script>

<div class="frame">
  <div class="composer-row">
    <!-- i18n-ignore (isolated preview copy) -->
    <DictationStopButton aria-label="Stop dictation" />
  </div>
  <ActionKeyHud />
</div>

<style>
  /* A transform makes the HUD's fixed position resolve inside this frame. */
  .frame {
    position: relative;
    transform: translateZ(0);
    width: 360px;
    height: 160px;
    padding: 16px;
  }
  .composer-row {
    display: flex;
    justify-content: flex-end;
  }
</style>
