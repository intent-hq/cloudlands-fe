<script lang="ts" module>
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import type {
    AgentSkillsUnavailable,
    SkillInfo,
  } from '$store/renderer/slices/skills/skills-types';

  interface Props {
    value?: string;
    skills?: SkillInfo[];
    /** A remote agent's machine, for its `/` menu copy. */
    machine?: string;
    stale?: boolean;
    unavailable?: AgentSkillsUnavailable | null;
  }

  const skills: SkillInfo[] = [
    { name: 'research', description: 'Research a topic', location: '/skills/research' },
    { name: 'review', description: 'Review a change', location: '/skills/review' },
  ];
  const machineSkills: SkillInfo[] = [
    {
      name: 'deploy',
      description: 'Deploy from this machine',
      location: '/Users/me/.claude/skills/deploy',
    },
    {
      name: 'review',
      description: 'Review a change',
      location: '/Users/me/checkout/.agents/skills/review',
    },
  ];
  const machine = 'Mac Studio';

  export const preview = definePreview<Props>({
    id: 'slash-skills',
    title: 'Prompt skill suggestions',
    defaultState: 'matching',
    states: {
      matching: { props: { value: '/re', skills } },
      'no-match': { props: { value: '/tmp', skills } },
      'no-skills': { props: { value: '/', skills: [] } },
      'remote-machine': { props: { value: '/', skills: machineSkills, machine } },
      'remote-no-skills': { props: { value: '/', skills: [], machine } },
      'remote-stale': { props: { value: '/', skills: machineSkills, machine, stale: true } },
      'remote-update-required': {
        props: {
          value: '/',
          skills: [machineSkills[1]],
          machine,
          unavailable: 'machine-update-required',
        },
      },
      'remote-offline': {
        props: { value: '/', skills: [], machine, unavailable: 'machine-offline' },
      },
      'remote-unknown-chip': {
        props: { value: '/deploy and /lint the change', skills: machineSkills, machine },
      },
    },
    captureReadiness: { selector: '.ProseMirror-focused' },
  });
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import TipTapEditor from './TipTapEditor.svelte';
  import { remoteSlashCopy } from './remote-agent-skills';

  let { value = '', skills = [], machine, stale = false, unavailable = null }: Props = $props();
  let editor: TipTapEditor;
  const copy = $derived(
    remoteSlashCopy(machine ? { machine, skills, stale, unavailable, ready: true } : undefined),
  );
  const editorSkills = $derived(
    value.includes('/lint') ? [...skills, { name: 'lint', description: '', location: '' }] : skills,
  );

  onMount(() => {
    editor.focusEnd();
  });
</script>

<!-- i18n-ignore (isolated preview with synthetic skill data) -->
<div class="flex min-h-48 w-full items-end p-4">
  <div class="rich-input-container w-full rounded-(--radius-medium) bg-card p-3">
    <TipTapEditor
      bind:this={editor}
      {value}
      skills={editorSkills}
      slashEmptyLabel={copy.emptyLabel}
      slashNotice={copy.notice}
      unavailableSkillTitle={copy.unavailableTitle}
      ariaLabel="Prompt"
    />
  </div>
</div>
