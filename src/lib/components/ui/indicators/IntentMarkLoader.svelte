<script lang="ts">
  import { m } from '$shared/paraglide/messages.js';
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
  viewBox="0 0 256 208"
  fill="none"
  role="status"
  aria-label={m.ui_spinner_loading_ariaLabel()}
  data-slot="intent-mark-loader"
  data-variant={variant}
  data-playing={playing}
  data-motion-state="neutral"
>
  <foreignObject x="0" y="0" width="256" height="208" overflow="visible" aria-hidden="true">
    <div class="intent-mark-arm-layer">
      <svg
        class="intent-mark-arm"
        viewBox="0 0 256 208"
        fill="none"
        aria-hidden="true"
        data-mark
        data-mark-arm-box
      >
        <path
          data-mark-arm="upper-left"
          data-bloom-arm="upper-left"
          pathLength="100"
          d="M76 8L94 61C99 76 92 83 78 77L27 48"
        />
      </svg>
      <svg
        class="intent-mark-arm"
        viewBox="0 0 256 208"
        fill="none"
        aria-hidden="true"
        data-mark
        data-mark-arm-box
      >
        <path
          data-mark-arm="upper-right"
          data-bloom-arm="upper-right"
          pathLength="100"
          d="M180 8L162 61C157 76 164 83 178 77L229 48"
        />
      </svg>
      <svg
        class="intent-mark-arm"
        viewBox="0 0 256 208"
        fill="none"
        aria-hidden="true"
        data-mark
        data-mark-arm-box
      >
        <path
          data-mark-arm="lower-left"
          data-bloom-arm="lower-left"
          pathLength="100"
          d="M16 104L68 96C83 94 89 102 79 114L45 157"
        />
      </svg>
      <svg
        class="intent-mark-arm"
        viewBox="0 0 256 208"
        fill="none"
        aria-hidden="true"
        data-mark
        data-mark-arm-box
      >
        <path
          data-mark-arm="lower-right"
          data-bloom-arm="lower-right"
          pathLength="100"
          d="M240 104L188 96C173 94 167 102 177 114L211 157"
        />
      </svg>
      <svg
        class="intent-mark-arm"
        viewBox="0 0 256 208"
        fill="none"
        aria-hidden="true"
        data-mark
        data-mark-arm-box
      >
        <path
          data-mark-arm="bottom"
          data-bloom-arm="bottom"
          pathLength="100"
          d="M128 126L128 184"
        />
      </svg>
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

  .intent-mark-arm-layer {
    position: relative;
    width: 256px;
    height: 208px;
  }

  .intent-mark-arm {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
    overflow: visible;
    pointer-events: none;
    transform: translate(0, 0) rotate(0deg) scale(1);
    transform-origin: 50% 46.153846%;
  }

  path {
    stroke: currentColor;
    stroke-width: 18;
    stroke-linecap: butt;
    stroke-linejoin: miter;
    stroke-miterlimit: 10;
    stroke-dasharray: 100 100;
    stroke-dashoffset: 0;
    transform: translate(0, 0) rotate(0deg) scale(1);
    transform-box: view-box;
    transform-origin: 128px 96px;
  }

  @media (forced-colors: active) {
    .intent-mark-loader {
      color: CanvasText;
    }
  }
</style>
