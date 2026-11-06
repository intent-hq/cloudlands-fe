<script lang="ts" module>
  export type DockComposerGlyph =
    | 'viewfinder'
    | 'window'
    | 'region'
    | 'video'
    | 'pencil'
    | 'target'
    | 'box'
    | 'pen'
    | 'arrow'
    | 'mic'
    | 'stop'
    | 'play'
    | 'x'
    | 'cursor'
    | 'check'
    | 'paperclip'
    | 'eraser'
    | 'trash'
    | 'click'
    | 'pause';
</script>

<script lang="ts">
  import type { Component } from 'svelte';
  import AppWindowIcon from 'phosphor-svelte/lib/AppWindowIcon';
  import ArrowUpRightIcon from 'phosphor-svelte/lib/ArrowUpRightIcon';
  import CheckIcon from 'phosphor-svelte/lib/CheckIcon';
  import CursorClickIcon from 'phosphor-svelte/lib/CursorClickIcon';
  import CursorIcon from 'phosphor-svelte/lib/CursorIcon';
  import EraserIcon from 'phosphor-svelte/lib/EraserIcon';
  import MicrophoneIcon from 'phosphor-svelte/lib/MicrophoneIcon';
  import PaperclipIcon from 'phosphor-svelte/lib/PaperclipIcon';
  import PauseIcon from 'phosphor-svelte/lib/PauseIcon';
  import PencilSimpleIcon from 'phosphor-svelte/lib/PencilSimpleIcon';
  import PlayIcon from 'phosphor-svelte/lib/PlayIcon';
  import RectangleDashedIcon from 'phosphor-svelte/lib/RectangleDashedIcon';
  import RectangleIcon from 'phosphor-svelte/lib/RectangleIcon';
  import ScanIcon from 'phosphor-svelte/lib/ScanIcon';
  import ScribbleIcon from 'phosphor-svelte/lib/ScribbleIcon';
  import StopIcon from 'phosphor-svelte/lib/StopIcon';
  import TrashIcon from 'phosphor-svelte/lib/TrashIcon';
  import VideoCameraIcon from 'phosphor-svelte/lib/VideoCameraIcon';
  import XIcon from 'phosphor-svelte/lib/XIcon';

  /**
   * Dock composer, annotate and recording glyphs: Phosphor icons at the regular
   * weight, one per glyph name, so every dock control draws from the same set.
   */
  let { glyph, size = 16 }: { glyph: DockComposerGlyph; size?: number } = $props();

  const icons: Record<DockComposerGlyph, Component<Record<string, unknown>>> = {
    viewfinder: ScanIcon,
    window: AppWindowIcon,
    region: RectangleDashedIcon,
    video: VideoCameraIcon,
    pencil: PencilSimpleIcon,
    target: CursorClickIcon,
    box: RectangleIcon,
    pen: ScribbleIcon,
    arrow: ArrowUpRightIcon,
    mic: MicrophoneIcon,
    stop: StopIcon,
    play: PlayIcon,
    x: XIcon,
    cursor: CursorIcon,
    check: CheckIcon,
    paperclip: PaperclipIcon,
    eraser: EraserIcon,
    trash: TrashIcon,
    click: CursorClickIcon,
    pause: PauseIcon,
  };
  const Icon = $derived(icons[glyph]);
</script>

<Icon {size} weight="regular" aria-hidden="true" focusable="false" data-dock-glyph={glyph} />
