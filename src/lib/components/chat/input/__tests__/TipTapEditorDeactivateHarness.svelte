<script lang="ts">
  import type { SkillInfo } from '$store/renderer/slices/skills/skills-types';
  import TipTapEditor from '../TipTapEditor.svelte';

  let { skills = [], releaseFocus }: { skills?: SkillInfo[]; releaseFocus: () => void } = $props();

  let editorRef: ReturnType<typeof TipTapEditor> | undefined = $state();
  let active = $state(true);

  export function insertText(text: string): boolean {
    return editorRef?.insertText(text) ?? false;
  }

  export function deactivate() {
    active = false;
  }

  // Mirrors Panel.svelte / RetainedWorkspaceSurfaces deactivation: flipping
  // `inert` via a template expression makes Chromium synchronously blur the
  // focused editor inside the same reactive flush. jsdom does not implement
  // inert-induced blur, so this reproduces it by blurring from inside the
  // reactive expression itself.
  const phase = $derived.by(() => {
    if (!active) releaseFocus();
    return active ? 'active' : 'inactive';
  });
</script>

<div data-phase={phase} inert={!active}>
  <TipTapEditor bind:this={editorRef} {skills} />
</div>
