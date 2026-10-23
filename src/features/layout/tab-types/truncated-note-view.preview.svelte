<script lang="ts" module>
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import { NOTE_VIEW_MAX_CONTENT_BYTES } from '$shared/constants/notes';

  /** Realistic Markdown sections (headings, prose, lists, tasks, code, tables). */
  function section(index: number): string {
    return [
      `## ${index}. Decision record for subsystem ${index}`,
      '',
      `The coordinator reviewed option ${index} against the latency budget and chose the staged rollout. ` +
        'Every step keeps the previous behavior available behind a flag, so a rollback is a config change. ' +
        'See [the plan](https://example.com/plan) and `packages/intentd/src/store.rs` for the details.',
      '',
      `- [x] Measure the baseline for step ${index}`,
      `- [ ] Land the **guarded** write path`,
      '- [ ] Remove the legacy index after one release',
      '',
      '```rust',
      `fn step_${index}(store: &Store) -> Result<()> {`,
      '    let tx = store.begin()?;',
      '    tx.commit()',
      '}',
      '```',
      '',
      '| Metric | Before | After |',
      '| --- | ---: | ---: |',
      `| p50 save (ms) | ${40 + (index % 17)} | ${4 + (index % 5)} |`,
      `| p99 save (ms) | ${900 + index} | ${30 + (index % 11)} |`,
      '',
      '> Agents can still read and edit the whole note through MCP.',
      '',
    ].join('\n');
  }

  /** Cut like the daemon does: the longest line-aligned prefix within the limit. */
  function truncatedPrefix(limit: number): { content: string; total: number } {
    const encoder = new TextEncoder();
    const parts: string[] = ['# Large workspace spec\n\n'];
    let bytes = encoder.encode(parts[0]).length;
    let total = bytes;
    for (let index = 1; total < 4_700_000; index++) {
      const next = section(index) + '\n';
      const size = encoder.encode(next).length;
      if (bytes + size <= limit) {
        parts.push(next);
        bytes += size;
      }
      total += size;
    }
    return { content: parts.join(''), total };
  }

  const large = truncatedPrefix(NOTE_VIEW_MAX_CONTENT_BYTES);

  export const preview = definePreview({
    id: 'truncated-note-view',
    title: 'Truncated note view',
    defaultState: 'large',
    captureReadiness: { selector: '[data-truncated-render-ready="true"]' },
    states: {
      large: { props: { content: large.content, contentBytes: large.total } },
      'no-total': { props: { content: section(1), contentBytes: undefined } },
    },
  });
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import TruncatedNoteView from './TruncatedNoteView.svelte';

  let { content, contentBytes }: { content: string; contentBytes?: number } = $props();
  let host: HTMLElement | null = $state(null);
  let renderMs = $state<number | null>(null);
  const startedAt = performance.now();
  const contentBytesShown = $derived(new TextEncoder().encode(content).length);

  // Preview-only timing: mount → rendered Markdown painted (two frames after the
  // rendered HTML lands), exposed for sandbox evidence.
  onMount(() => {
    const observer = new MutationObserver(() => {
      if (!host?.querySelector('.markdown-content > *')) return;
      observer.disconnect();
      requestAnimationFrame(() =>
        requestAnimationFrame(() => (renderMs = Math.round(performance.now() - startedAt))),
      );
    });
    if (host) observer.observe(host, { childList: true, subtree: true });
    return () => observer.disconnect();
  });
</script>

<div
  class="h-[640px]"
  bind:this={host}
  data-truncated-render-ready={renderMs !== null}
  data-render-ms={renderMs}
  data-content-bytes={contentBytesShown}
>
  <TruncatedNoteView
    {content}
    {contentBytes}
    shownBytes={NOTE_VIEW_MAX_CONTENT_BYTES}
    workspaceId="preview-workspace"
    noteId="preview-large-note"
    scrollKey="preview-large-note"
  />
</div>
