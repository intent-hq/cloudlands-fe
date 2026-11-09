<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import { store as appStore } from '$store/renderer/store';
  import {
    radialPromptPickerClosed,
    radialPromptPickerOpened,
  } from '$store/renderer/slices/hardware-console/hardware-console-slice';
  import { RADIAL_CANCEL_SLOT, buildRadialSlots } from './radial-layout';

  const USED = [
    'Run the tests and fix any failures before you continue',
    'Commit and push',
    'Address every unresolved review comment on the open PR, then re-request review',
    'Continue',
    'Show me before/after screenshots in light and dark themes',
    'Open a draft PR with a short summary of the change',
    'Explain the root cause in plain English',
  ];
  const SUGGESTIONS = [
    'Hold off on merging [#5034](https://github.com/intent-hq/intent/pull/5034) until I review the diff',
    'Skip the verifier pass and open the PR now',
    'Show me the ring with only two suggestions',
  ];

  function open(suggestions: string[], used: string[], sector: number | null) {
    return () => {
      appStore.dispatch(radialPromptPickerOpened(buildRadialSlots(suggestions, used), sector));
      return () => appStore.dispatch(radialPromptPickerClosed());
    };
  }

  export const preview = definePreview({
    id: 'radial-prompt-picker',
    title: 'Micro joystick prompt ring',
    defaultState: 'suggestions',
    states: {
      suggestions: { props: {}, setup: open(SUGGESTIONS, USED, 1) },
      'no-suggestions': { props: {}, setup: open([], USED, 0) },
      'two-suggestions-cancel': {
        props: {},
        setup: open(SUGGESTIONS.slice(0, 2), USED, RADIAL_CANCEL_SLOT),
      },
      sparse: { props: {}, setup: open(['Continue'], ['Commit and push'], null) },
    },
    captureReadiness: { selector: '.radial-ring' },
  });
</script>

<script lang="ts">
  import RadialPromptPickerOverlay from './RadialPromptPickerOverlay.svelte';
</script>

<!-- i18n-ignore (isolated, static preview of the joystick prompt ring) -->
<section
  class="relative h-[720px] w-full transform overflow-hidden rounded-lg border border-border bg-background"
  data-testid="radial-prompt-picker-preview"
>
  <RadialPromptPickerOverlay />
</section>
