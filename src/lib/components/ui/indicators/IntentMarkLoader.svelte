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
  <g aria-hidden="true" data-mark>
    <path
      data-mark-arm="upper-left"
      data-bloom-arm="upper-left"
      pathLength="100"
      d="M76 8L94 61C99 76 92 83 78 77L27 48"
    />
    <path
      data-mark-arm="upper-right"
      data-bloom-arm="upper-right"
      pathLength="100"
      d="M180 8L162 61C157 76 164 83 178 77L229 48"
    />
    <path
      data-mark-arm="lower-left"
      data-bloom-arm="lower-left"
      pathLength="100"
      d="M16 104L68 96C83 94 89 102 79 114L45 157"
    />
    <path
      data-mark-arm="lower-right"
      data-bloom-arm="lower-right"
      pathLength="100"
      d="M240 104L188 96C173 94 167 102 177 114L211 157"
    />
    <path data-mark-arm="bottom" data-bloom-arm="bottom" pathLength="100" d="M128 126L128 184" />
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
