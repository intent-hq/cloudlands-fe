import { mount, unmount } from 'svelte';
import MermaidRenderer from '$lib/components/markdown/MermaidRenderer.svelte';
import type {
  NativeConstructionAdapter,
  NativeConstructionContext,
} from '../../../primitive-host/shared/adapter';
import { measureNoteDom } from '../../note-dom-cost';
import { streamMermaidScene } from './mermaid-scene';

/** Native semantic adapter. Import only in the isolated construction entry, never
 * in the active reader. Full-source join, native parser/layout and renderer-owned
 * SVG serialization remain explicit construction work, not bounded consumer work.
 */
export function createMermaidConstructionAdapter(): NativeConstructionAdapter {
  const lifetime = new AbortController();
  let running = false;
  return {
    async construct({ job, root, signal: suppliedSignal, io }: NativeConstructionContext) {
      if (running) throw new Error('Mermaid construction already started');
      running = true;
      const signal = AbortSignal.any([suppliedSignal, lifetime.signal]);
      signal.throwIfAborted();
      const chunks: string[] = [];
      let sourceUnits = 0,
        sourceChunkCount = 0;
      for await (const chunk of io.source) {
        signal.throwIfAborted();
        chunks.push(chunk);
        sourceUnits += chunk.length;
        sourceChunkCount++;
      }
      signal.throwIfAborted();
      const code = chunks.join('');
      chunks.length = 0;
      let instance: ReturnType<typeof mount> | undefined;
      let observer: MutationObserver | undefined;
      let abort: (() => void) | undefined;
      try {
        const svg = await new Promise<SVGSVGElement | null>((resolve, reject) => {
          abort = () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
          signal.addEventListener('abort', abort, { once: true });
          const inspect = () => {
            if (signal.aborted) return;
            const renderer = root.querySelector('.mermaid-renderer[data-render-settled="true"]');
            const svg = renderer?.querySelector<SVGSVGElement>('svg[id^="mermaid-"]');
            if (svg) resolve(svg);
          };
          observer = new MutationObserver(inspect);
          observer.observe(root, { subtree: true, childList: true, attributes: true });
          instance = mount(MermaidRenderer, {
            target: root,
            props: {
              code,
              isStreaming: false,
              showExpandButton: false,
              showSourceButton: false,
              showExportButton: false,
              onRenderStateChange: (state) => {
                if (state === 'error') reject(new Error('Native Mermaid rendering failed'));
                else if (state === 'empty') resolve(null);
                else inspect();
              },
            },
          });
          inspect();
        });
        observer!.disconnect();
        signal.throwIfAborted();
        const dom = measureNoteDom(root);
        const output = svg
          ? await streamMermaidScene(svg, { signal, append: io.append })
          : { nodes: 0, records: 0, outputBytes: 0, maxRecordBytes: 0 };
        signal.throwIfAborted();
        io.reportCosts({
          peakDomNodes: dom.nodes,
          native: {
            sourceUnits,
            sourceChunkCount,
            // Logical inputs to join, not measured physical string/heap allocation.
            sourceJoinUnits: sourceUnits * 2,
            settledDomPayloadBytes: dom.payloadBytes,
            settledDomNodes: dom.nodes,
            sceneRecords: output.records,
            maxSceneRecordBytes: output.maxRecordBytes,
          },
        });
        await io.seal(
          JSON.stringify({
            kind: 'nativeMermaidScene',
            version: 1,
            identity: job.identity,
            profile: job.profile,
            empty: svg === null,
            viewBox: svg?.getAttribute('viewBox') ?? null,
            ...output,
          }),
        );
        signal.throwIfAborted();
      } finally {
        observer?.disconnect();
        if (abort) signal.removeEventListener('abort', abort);
        if (instance) await unmount(instance);
      }
    },
    dispose() {
      lifetime.abort();
    },
  };
}
