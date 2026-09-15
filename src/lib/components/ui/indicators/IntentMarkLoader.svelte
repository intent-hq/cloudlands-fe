<script lang="ts">
  import { m } from '$shared/paraglide/messages.js';
  import {
    intentMarkPaths,
    intentMarkStrokeWidth,
    intentMarkViewBox,
    pulseKeyframes,
  } from './intent-mark-vector';
  import {
    createIntentMarkMotion,
    type IntentMarkMotionOptions,
    type IntentMarkVariant,
  } from './intent-mark-motion';

  interface Props {
    variant?: IntentMarkVariant;
    size?: number;
    playing?: boolean;
    class?: string;
  }

  let { variant = 'bloom', size = 24, playing = true, class: className = '' }: Props = $props();

  function markMotion(node: SVGSVGElement, options: IntentMarkMotionOptions) {
    const controller = createIntentMarkMotion(node, options);
    return {
      update(next: IntentMarkMotionOptions) {
        controller.update(next);
      },
      destroy() {
        controller.destroy();
      },
    };
  }
</script>

<svg
  use:markMotion={{ variant, playing }}
  class="intent-mark-loader {className}"
  width={size}
  height={size}
  viewBox={intentMarkViewBox}
  fill="none"
  role="status"
  aria-label={m.ui_spinner_loading_ariaLabel()}
  data-slot="intent-mark-loader"
  data-variant={variant}
  data-playing={playing}
  data-motion-state="neutral"
>
  <g data-mark-layer="neutral" aria-hidden="true">
    {#each intentMarkPaths as d, index}
      <path
        {d}
        data-mark-arm={index}
        pathLength="100"
        stroke="currentColor"
        stroke-width={intentMarkStrokeWidth}
        style:transform={String(pulseKeyframes(index)[0].transform)}
      />
    {/each}
  </g>
</svg>

<style>
  .intent-mark-loader {
    display: inline-block;
    flex: none;
    overflow: visible;
    color: inherit;
    contain: layout paint style;
    forced-color-adjust: auto;
    vertical-align: middle;
  }

  path {
    pointer-events: none;
    stroke-linecap: butt;
    stroke-linejoin: round;
    stroke-dasharray: 100 200;
    stroke-dashoffset: 0;
    transform-origin: 0 0;
  }

  @media (forced-colors: active) {
    .intent-mark-loader {
      color: CanvasText;
    }
  }
</style>
