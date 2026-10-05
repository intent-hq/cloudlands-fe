<script lang="ts" module>
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import type { MentionCandidate } from '$lib/services/mentions/types';

  interface Props {
    state?: 'mixed' | 'many' | 'loading' | 'empty' | 'composer' | 'members';
    composerTop?: number;
  }

  export const preview = definePreview<Props>({
    id: 'mention-results',
    title: 'Mention results',
    defaultState: 'mixed',
    states: {
      mixed: { props: { state: 'mixed' } },
      many: { props: { state: 'many' } },
      loading: { props: { state: 'loading' } },
      empty: { props: { state: 'empty' } },
      composer: { props: { state: 'composer' } },
      members: { props: { state: 'members' } },
    },
  });

  const candidates: MentionCandidate[] = [
    {
      id: 'mention-preview-agent',
      type: 'agent',
      label: 'Developer',
      subtitle: 'Developer · idle · 12 messages',
      uri: 'devspace://agent/mention-preview-agent',
      group: 'Agents',
    },
    {
      id: 'specialist-developer',
      type: 'specialist',
      label: 'Developer',
      subtitle: 'Plans and implements development tasks with focused verification.',
      uri: 'devspace://specialist/developer',
      group: 'Specialists',
      meta: { promptToken: 'specialist/developer' },
    },
    {
      id: 'file-developer-guide',
      type: 'file',
      label: 'DEVELOPER_GUIDE.md',
      subtitle: 'packages/application/src/features/developer/documentation/DEVELOPER_GUIDE.md',
      uri: 'file://packages/application/src/features/developer/documentation/DEVELOPER_GUIDE.md',
      group: 'Files',
    },
    {
      id: 'script-development',
      type: 'script',
      label: 'Development preview service',
      subtitle: 'Running · pnpm --filter application run development --host 127.0.0.1 --port 5872',
      uri: 'devspace://script/development',
      group: 'Scripts',
    },
    {
      id: 'file-long',
      type: 'file',
      label: 'developer-preview-component-with-a-very-long-unbroken-filename.svelte',
      subtitle: 'src/features/developer/components/preview',
      uri: 'file://src/features/developer/components/preview/long.svelte',
      group: 'Files',
    },
  ];
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import EnhancedMentionList from './EnhancedMentionList.svelte';
  import TipTapEditor from './TipTapEditor.svelte';
  import { getMentionSystem } from '$lib/services/mentions';
  import { Input } from '$lib/components/ui/input';
  import MemberMentionsHost from './__tests__/MemberMentionsHost.svelte';

  let { state: scenario = 'mixed', composerTop = 320 }: Props = $props();
  let query = $state('');
  let selected = $state('');
  let closed = $state(false);
  let list = $state<EnhancedMentionList>();
  const source = $derived(
    scenario === 'many'
      ? Array.from({ length: 24 }, (_, index) => ({
          ...candidates[2],
          id: `file-${index}`,
          label: `developer-module-${index}.ts`,
        }))
      : candidates,
  );
  const items = $derived(
    scenario === 'empty' || scenario === 'loading'
      ? []
      : source.filter((item) =>
          `${item.label} ${item.subtitle}`.toLowerCase().includes(query.toLowerCase()),
        ),
  );

  onMount(() => {
    if (scenario !== 'composer') return;
    // Only this isolated fixture replaces the search boundary; no providers or daemon calls run.
    // eslint-disable-next-line intent/no-component-async-data-fetch -- synthetic preview replaces search; it never fetches domain data.
    const system = getMentionSystem();
    const originalSearch = system.search;
    system.search = async (query) =>
      candidates.filter((item) =>
        `${item.label} ${item.subtitle}`.toLowerCase().includes(query.toLowerCase()),
      );
    return () => {
      system.search = originalSearch;
    };
  });
</script>

<!-- i18n-ignore (isolated fixture controls and synthetic demo data) -->
<div class="mention-preview" data-testid="mention-preview">
  {#if scenario === 'members'}
    <MemberMentionsHost />
  {:else if scenario === 'composer'}
    <div class="rich-input-container" style:margin-top={`${composerTop}px`}>
      <TipTapEditor ariaLabel="Mention composer" repoPath="/fixture/mention-results" />
    </div>
  {:else}
    <Input
      aria-label="Filter mentions"
      bind:value={query}
      onkeydown={(event) => list?.onKeyDown({ event })}
    />
    {#if !closed}
      <EnhancedMentionList
        bind:this={list}
        {items}
        loading={scenario === 'loading'}
        command={(item) => {
          selected = `${item.type}:${item.id}`;
        }}
        onClose={() => {
          closed = true;
        }}
      />
    {/if}
    <output data-testid="mention-selection">{selected}</output>
  {/if}
</div>

<style>
  .mention-preview {
    width: 100%;
    min-width: 0;
    display: grid;
    gap: 8px;
  }
  .rich-input-container {
    position: relative;
    min-height: 80px;
  }
  output:empty {
    display: none;
  }
</style>
