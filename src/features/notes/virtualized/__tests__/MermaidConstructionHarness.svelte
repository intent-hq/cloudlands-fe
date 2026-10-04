<script lang="ts">
  import { onMount } from 'svelte';
  import { createMermaidConstructionAdapter } from '../primitives/mermaid/mermaid-construction';
  import type { NativeConstructionContext } from '../../primitive-host/shared/adapter';
  let { code }: { code: string } = $props();
  let root: HTMLDivElement;
  let status = $state('loading');
  onMount(() => {
    const controller = new AbortController();
    const adapter = createMermaidConstructionAdapter();
    const records: string[] = [];
    let costs: unknown;
    let manifest: unknown;
    const job: NativeConstructionContext['job'] = {
      version: 1,
      token: 'test-token',
      adapter: 'mermaid',
      chunkBytes: 16384,
      identity: {
        backendId: 'test',
        workspaceId: 'test',
        noteId: 'test',
        noteInstanceId: 'test',
        ownerRef: 'owner',
        sourceRef: 'source',
        profileId: 'native-profile',
        jobId: 'job',
        source: { kind: 'snapshot', snapshotId: 'snapshot', sourceRevision: 'revision' },
      },
      profile: {
        width: 900,
        height: 520,
        theme: 'light',
        font: 'Inter Variable',
        fontSize: 14,
        devicePixelRatio: 1,
      },
    };
    // Test-only record collector. Production ownership is the acknowledged host sink.
    void adapter
      .construct({
        job,
        root,
        signal: controller.signal,
        io: {
          source: {
            async *[Symbol.asyncIterator]() {
              for (let i = 0; i < code.length; i += 2048) yield code.slice(i, i + 2048);
            },
          },
          append: async (record) => {
            records.push(record);
          },
          seal: async (value) => {
            manifest = JSON.parse(value);
          },
          reportCosts: (value) => {
            costs = value;
          },
        },
      })
      .then(() => {
        (root as HTMLDivElement & { result: unknown }).result = {
          records,
          manifest,
          costs,
          remainingNodes: root.childNodes.length,
        };
        status = 'ready';
      })
      .catch(() => {
        status = 'failed';
      });
    return () => {
      controller.abort();
      adapter.dispose();
    };
  });
</script>

<div data-testid="mermaid-construction-harness" data-status={status}>
  <div bind:this={root} data-testid="construction-root" style="width:900px;min-height:520px"></div>
</div>
