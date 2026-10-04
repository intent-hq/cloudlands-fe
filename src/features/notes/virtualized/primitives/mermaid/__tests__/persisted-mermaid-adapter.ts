import { mount, unmount } from 'svelte';
import MermaidRenderer from '$lib/components/markdown/MermaidRenderer.svelte';
import type {
  NativeConstructionAdapter,
  NativeConstructionContext,
} from '../../../../primitive-host/shared/adapter';
import { measureNoteDom } from '../../../note-dom-cost';
import { captureBands, nativeCamera } from './capture-plan';

// TEST ONLY full native constructor. No SVG serialization or bitmap crosses renderer IPC.
// Main interprets bounded test-capture markers inside its awaited append resource callback.
export function createPersistedMermaidAdapter(): NativeConstructionAdapter {
  const lifetime = new AbortController();
  let active: Promise<void> | undefined;
  return {
    construct(context) {
      if (active) throw new Error('Test construction already started');
      return (active = construct(context, lifetime.signal));
    },
    async dispose() {
      lifetime.abort();
      await active?.catch(() => undefined); // construct already reports its failure; settle owned work.
    },
  };
}
async function construct(context: NativeConstructionContext, lifetime: AbortSignal) {
  const signal = AbortSignal.any([context.signal, lifetime]);
  const chunks: string[] = [];
  let sourceUnits = 0;
  for await (const part of context.io.source) {
    signal.throwIfAborted();
    chunks.push(part);
    sourceUnits += part.length;
  }
  signal.throwIfAborted();
  const code = chunks.join('');
  chunks.length = 0;
  const camera = document.createElement('div');
  camera.style.cssText = 'width:256px;height:256px;overflow:hidden;position:relative';
  camera.style.background = context.job.profile.theme === 'dark' ? '#171717' : '#ffffff';
  const construction = document.createElement('div');
  construction.style.cssText = 'width:900px;transform-origin:0 0;transition-property:none';
  camera.append(construction);
  context.root.append(camera);
  let instance: ReturnType<typeof mount> | undefined;
  let observer: MutationObserver | undefined;
  let abort: (() => void) | undefined;
  const frame = async () => {
    signal.throwIfAborted();
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    signal.throwIfAborted();
  };
  async function append(kind: string, value: unknown) {
    signal.throwIfAborted();
    const record = JSON.stringify({ kind, value });
    if (new TextEncoder().encode(record).length > context.job.chunkBytes)
      throw new Error('Test record exceeds host budget');
    await context.io.append(record);
    signal.throwIfAborted();
  }
  try {
    const svg = await new Promise<SVGSVGElement>((resolve, reject) => {
      abort = () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      signal.addEventListener('abort', abort, { once: true });
      const inspect = () => {
        const element = construction.querySelector<SVGSVGElement>(
          '.mermaid-renderer[data-render-settled="true"] .mermaid-svg > svg',
        );
        if (element) resolve(element);
      };
      observer = new MutationObserver(inspect);
      observer.observe(construction, { subtree: true, childList: true, attributes: true });
      instance = mount(MermaidRenderer, {
        target: construction,
        props: {
          code,
          isStreaming: false,
          showExpandButton: false,
          showSourceButton: false,
          showExportButton: false,
          onRenderStateChange: (state) => {
            if (state === 'error' || state === 'empty')
              reject(new Error('Native test Mermaid failed'));
            else inspect();
          },
        },
      });
      inspect();
    });
    observer.disconnect();
    await document.fonts.ready;
    await frame();
    const scroller = construction.querySelector<HTMLElement>('.mermaid-svg-viewport');
    const labels = svg.querySelectorAll('.node .nodeLabel, .messageText');
    const label = labels[labels.length - 1];
    if (!scroller || !label) throw new Error('Native target missing');
    for (const [index, scale] of [1, 2].entries()) {
      construction.style.transform = '';
      scroller.scrollLeft = 0;
      scroller.scrollTop = 0;
      await frame();
      const source = svg.getBoundingClientRect(),
        target = label.getBoundingClientRect();
      const plan = nativeCamera(source, target, scale),
        host = construction.getBoundingClientRect();
      scroller.scrollLeft = plan.x;
      scroller.scrollTop = plan.y;
      const panned = svg.getBoundingClientRect();
      construction.style.transform = `translate(${-(panned.left - host.left + plan.x) * scale}px, ${-(panned.top - host.top + plan.y) * scale}px) scale(${scale})`;
      await frame();
      const shown = label.getBoundingClientRect(),
        viewport = camera.getBoundingClientRect(),
        clip = scroller.getBoundingClientRect();
      if (
        viewport.x !== 0 ||
        viewport.y !== 0 ||
        viewport.width !== 256 ||
        viewport.height !== 256 ||
        devicePixelRatio !== 1
      )
        throw new Error('Test camera profile mismatch');
      if (
        !label.isConnected ||
        shown.left < Math.max(viewport.left, clip.left) ||
        shown.right > Math.min(viewport.right, clip.right) ||
        shown.top < Math.max(viewport.top, clip.top) ||
        shown.bottom > Math.min(viewport.bottom, clip.bottom)
      )
        throw new Error('Native target not visible');
      const text = label.textContent ?? '';
      if (text.length > 256) throw new Error('Test target label exceeds metadata budget');
      await append('camera', {
        index,
        scale,
        identity: context.job.identity,
        profile: context.job.profile,
        text,
        geometry: {
          source: source.toJSON(),
          target: shown.toJSON(),
          viewport: viewport.toJSON(),
          clip: clip.toJSON(),
        },
        environment: {
          font: getComputedStyle(label).font,
          dpr: devicePixelRatio,
          fonts: document.fonts.status,
          width: innerWidth,
          height: innerHeight,
        },
        dom: measureNoteDom(construction),
      });
      for (const band of captureBands(index))
        await append('test-capture', {
          ...band,
          identity: context.job.identity,
          dpr: devicePixelRatio,
          scale,
        });
    }
    const dom = measureNoteDom(construction);
    context.io.reportCosts({
      peakDomNodes: dom.nodes,
      native: {
        sourceUnits,
        sourceJoinUnits: sourceUnits * 2,
        settledDomPayloadBytes: dom.payloadBytes,
        settledDomNodes: dom.nodes,
        cameras: 2,
        captureBands: 8,
      },
    });
    await context.io.seal(
      JSON.stringify({
        kind: 'manifest',
        value: {
          identity: context.job.identity,
          profile: context.job.profile,
          limitations: [
            'test-only native paint',
            'DPR1 only, CSS zoom1 and2',
            'no semantic, accessibility, interaction or source-map acceptance',
            'full parser/layout/DOM remain construction work',
          ],
        },
      }),
    );
  } finally {
    observer?.disconnect();
    if (abort) signal.removeEventListener('abort', abort);
    if (instance) await unmount(instance);
    camera.remove();
  }
}
export const adapters = { 'test-mermaid-paint': createPersistedMermaidAdapter };
