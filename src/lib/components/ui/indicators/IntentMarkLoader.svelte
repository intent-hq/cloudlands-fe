<script lang="ts">
  import { m } from '$shared/paraglide/messages.js';
  import neutralUrl from '../../../../../static/intent-mark/neutral.png?url';
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
  viewBox="0 0 256 256"
  fill="none"
  role="status"
  aria-label={m.ui_spinner_loading_ariaLabel()}
  data-slot="intent-mark-loader"
  data-variant={variant}
  data-playing={playing}
  data-motion-state="neutral"
>
  <foreignObject x="0" y="0" width="256" height="256" aria-hidden="true">
    <div class="intent-mark-viewport">
      <div
        class="intent-mark-sheet"
        data-mark-sheet="neutral"
        style:mask-image={`url("${neutralUrl}")`}
      ></div>
    </div>
  </foreignObject>
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

  .intent-mark-viewport {
    position: relative;
    width: 256px;
    height: 256px;
    overflow: hidden;
    contain: strict;
  }

  .intent-mark-sheet {
    position: absolute;
    top: 0;
    left: 0;
    width: 256px;
    height: 256px;
    background: currentColor;
    mask-mode: alpha;
    mask-repeat: no-repeat;
    pointer-events: none;
    transform: translate(0px, 0px);
    forced-color-adjust: none;
  }

  @media (forced-colors: active) {
    .intent-mark-loader {
      color: CanvasText;
    }
  }
</style>
