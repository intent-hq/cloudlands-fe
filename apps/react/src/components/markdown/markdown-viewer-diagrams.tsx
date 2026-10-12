// Source: src/lib/components/markdown/markdown-diagrams.ts (framework lifecycle adapter).
import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { logger } from '$lib/utils/client-logger';
import type { MarkdownDiagramProps } from './markdown-diagram';

type Renderer = typeof import('./markdown-diagram').MarkdownDiagram;
interface DiagramOptions {
  enabled: boolean;
  workspaceId?: string;
  onOpenFile: MarkdownDiagramProps['onOpenFile'];
  onOpenLink: MarkdownDiagramProps['onOpenLink'];
}
interface MountedDiagram {
  node: HTMLElement;
  host: HTMLElement;
  source: HTMLElement;
  key: number;
  kind: 'mermaid' | 'diagram';
  text: string;
  workspaceId?: string;
  renderer: Renderer;
}

export function useMarkdownDiagrams(node: HTMLElement | null, options: DiagramOptions) {
  const { enabled, workspaceId, onOpenFile, onOpenLink } = options;
  const [diagrams, setDiagrams] = useState<MountedDiagram[]>([]);
  const nextKey = useRef(0);
  const loadedRenderer = useRef<Renderer | undefined>(undefined);
  useLayoutEffect(() => {
    if (!node) return;
    let loading = false;
    let disposed = false;
    const mounted = new Map<HTMLElement, MountedDiagram>();
    function reconcile() {
      if (disposed || !node) return;
      let changed = false;
      for (const host of mounted.keys()) {
        if (!node.contains(host)) {
          mounted.delete(host);
          changed = true;
        }
      }
      if (enabled)
        for (const code of node.querySelectorAll<HTMLElement>('pre > code')) {
          // Source disclosure inside a mounted diagram must remain literal.
          if (code.closest('[data-markdown-diagram]')) continue;
          const language = [...code.classList]
            .find((name) => name.startsWith('language-'))
            ?.slice(9);
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
          if (!loadedRenderer.current) {
            if (!loading) {
              loading = true;
              void import('./markdown-diagram')
                .then((module) => {
                  if (disposed) return;
                  loadedRenderer.current = module.MarkdownDiagram;
                  loading = false;
                  reconcile();
                })
                .catch((error) => {
                  if (disposed) return;
                  loading = false;
                  logger.error('Failed to load the Markdown diagram renderer', { error });
                });
            }
            break;
          }
          const host = document.createElement('div');
          host.dataset.markdownDiagram = kind;
          source.replaceWith(host);
          mounted.set(host, {
            node,
            host,
            source,
            key: nextKey.current++,
            kind,
            text: code.textContent ?? '',
            workspaceId,
            renderer: loadedRenderer.current,
          });
          changed = true;
        }
      if (changed) setDiagrams([...mounted.values()]);
    }
    const observer = new MutationObserver(reconcile);
    observer.observe(node, { childList: true, subtree: true });
    queueMicrotask(reconcile);
    return () => {
      disposed = true;
      observer.disconnect();
      for (const [host, { source }] of mounted) {
        if (node.contains(host)) host.replaceWith(source);
      }
      mounted.clear();
      setDiagrams([]);
    };
  }, [node, enabled, workspaceId]);

  // Unlike an independent React root, a portal keeps all surrounding provider contexts.
  return diagrams
    .filter((entry) => enabled && entry.node === node && entry.workspaceId === workspaceId)
    .map((entry) => {
      const Diagram = entry.renderer;
      return createPortal(
        <Diagram
          kind={entry.kind}
          source={entry.text}
          workspaceId={entry.workspaceId}
          onOpenFile={onOpenFile}
          onOpenLink={onOpenLink}
        />,
        entry.host,
        String(entry.key),
      );
    });
}
