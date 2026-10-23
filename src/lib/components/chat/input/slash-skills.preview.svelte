<script lang="ts" module>
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import type { SkillInfo } from '$store/renderer/slices/skills/skills-types';

  interface Props {
    value?: string;
    skills?: SkillInfo[];
  }

  const skills: SkillInfo[] = [
    { name: 'research', description: 'Research a topic', location: '/skills/research' },
    { name: 'review', description: 'Review a change', location: '/skills/review' },
  ];

  export const preview = definePreview<Props>({
    id: 'slash-skills',
    title: 'Prompt skill suggestions',
    defaultState: 'matching',
    states: {
      matching: { props: { value: '/re', skills } },
      'no-match': { props: { value: '/tmp', skills } },
      'no-skills': { props: { value: '/', skills: [] } },
    },
    captureReadiness: { selector: '.ProseMirror-focused' },
  });
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import TipTapEditor from './TipTapEditor.svelte';

  let { value = '', skills = [] }: Props = $props();
  let editor: TipTapEditor;

  onMount(() => {
    editor.focusEnd();
  });
</script>

<!-- i18n-ignore (isolated preview with synthetic skill data) -->
<div class="flex min-h-48 w-full items-end p-4">
  <div class="rich-input-container w-full rounded-(--radius-medium) bg-card p-3">
    <TipTapEditor bind:this={editor} {value} {skills} ariaLabel="Prompt" />
  </div>
</div>
