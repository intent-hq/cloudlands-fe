import { mount, unmount } from 'svelte';
import { logger } from '$lib/utils/client-logger';

interface DiagramOptions {
  enabled: boolean;
  workspaceId?: string;
  context: Map<unknown, unknown>;
}

export function markdownDiagrams(node: HTMLElement, initialOptions: DiagramOptions) {
  let options = initialOptions;
  let renderer: typeof import('./MarkdownDiagram.svelte').default | undefined;
  let loading = false;
  let disposed = false;
  const mounted = new Map<
    HTMLElement,
    { component: ReturnType<typeof mount>; source: HTMLElement }
  >();

  function clear() {
    for (const [host, { component, source }] of mounted) {
      void unmount(component);
      if (node.contains(host)) host.replaceWith(source);
    }
    mounted.clear();
  }

  function reconcile() {
    if (disposed) return;
    for (const [host, { component }] of mounted) {
      if (!node.contains(host)) {
        void unmount(component);
        mounted.delete(host);
      }
    }
    if (!options.enabled) return;
    for (const code of node.querySelectorAll<HTMLElement>('pre > code')) {
      // Source disclosure inside a mounted diagram must remain literal.
      if (code.closest('[data-markdown-diagram]')) continue;
      const language = [...code.classList].find((name) => name.startsWith('language-'))?.slice(9);
      let kind: 'mermaid' | 'diagram';
      if (language === 'mermaid') kind = 'mermaid';
      else if (language === 'diagram' || language === 'ws-block:diagram') kind = 'diagram';
      else if (language === 'ws-block') {
        try {
          if (JSON.parse(code.textContent ?? '').type !== 'diagram') continue;
          kind = 'diagram';
        } catch {
          continue;
        }
      } else continue;

      const source = code.parentElement;
      if (!source) continue;
      if (!renderer) {
        if (!loading) {
          loading = true;
          void import('./MarkdownDiagram.svelte')
            .then((module) => {
              renderer = module.default;
              loading = false;
              reconcile();
            })
            .catch((error) => {
              loading = false;
              logger.error('Failed to load the Markdown diagram renderer', { error });
            });
        }
        return;
      }
      const host = document.createElement('div');
      host.dataset.markdownDiagram = kind;
      source.replaceWith(host);
      const component = mount(renderer, {
        target: host,
        context: options.context,
        props: { kind, source: code.textContent ?? '', workspaceId: options.workspaceId },
      });
      mounted.set(host, { component, source });
    }
  }

  const observer = new MutationObserver(reconcile);
  observer.observe(node, { childList: true, subtree: true });
  queueMicrotask(reconcile);

  return {
    update(nextOptions: DiagramOptions) {
      if (
        options.enabled !== nextOptions.enabled ||
        options.workspaceId !== nextOptions.workspaceId
      )
        clear();
      options = nextOptions;
      reconcile();
    },
    destroy() {
      disposed = true;
      observer.disconnect();
      clear();
    },
  };
}
