<script lang="ts">
  import {
  marked,
  type Tokens,
} from 'marked';
  import CodeBlock from './CodeBlock.svelte';
  import AugmentCodeSnippet from './AugmentCodeSnippet.svelte';
  import MermaidRenderer from '$lib/components/markdown/MermaidRenderer.svelte';
  import { DiffViewer } from '$lib/components/ui/diff';
  import { createLogger } from '$lib/utils/client-logger';
  import { withSyntheticDiffHeaders } from '$lib/utils/diff-patch-utils';
  import { handleLink } from '$features/navigation/link-handler';
  import { selectActiveWorkspaceId } from '$lib/store/slices/workspace/workspace-selectors';

  const logger = createLogger('MarkdownRenderer');
  const activeWorkspaceId = selectActiveWorkspaceId();

  interface Props {
    content?: string;
    className?: string;
    onOpenFile?: (detail: any) => void;
  }

  let { content = '', className = '', onOpenFile }: Props = $props();


  interface RenderedBlock {
    type: 'html' | 'code' | 'augment-snippet' | 'mermaid' | 'diff';
    content: string;
    language?: string;
    id?: string;
    path?: string;
    mode?: string;
  }

  let blocks: RenderedBlock[] = $state([]);

  // Store code blocks outside the renderer
  let codeBlocksMap = new Map<string, RenderedBlock>();

  // Custom renderer to extract code blocks
  class CustomRenderer extends marked.Renderer {
    code({ text, lang }: Tokens.Code) {
      const id = `code-${Math.random().toString(36).substring(2, 11)}`;

      // Check if this is a mermaid diagram
      if (lang === 'mermaid') {
        const codeBlock: RenderedBlock = {
          type: 'mermaid',
          content: text,
          id,
        };
        codeBlocksMap.set(id, codeBlock);
        return `<div data-code-block="${id}"></div>`;
      }

      // Check if this is a diff block
      if (lang === 'diff') {
        const codeBlock: RenderedBlock = {
          type: 'diff',
          content: text,
          id,
        };
        codeBlocksMap.set(id, codeBlock);
        return `<div data-code-block="${id}"></div>`;
      }

      // Check if this is an augment_code_snippet (format: language:augment-snippet:path:mode)
      if (lang && lang.includes(':augment-snippet:')) {
        const parts = lang.split(':');
        const language = parts[0] || 'plaintext';
        const path = parts[2] || '';
        const mode = parts[3] || 'EXCERPT';

        const codeBlock: RenderedBlock = {
          type: 'augment-snippet',
          content: text,
          language,
          path,
          mode,
          id,
        };
        codeBlocksMap.set(id, codeBlock);
        return `<div data-code-block="${id}"></div>`;
      }

      // Regular code block
      const codeBlock: RenderedBlock = {
        type: 'code',
        content: text,
        language: lang || 'plaintext',
        id,
      };
      codeBlocksMap.set(id, codeBlock);
      return `<div data-code-block="${id}"></div>`;
    }

    heading({ text, depth }: Tokens.Heading) {
      // Enhanced heading styles based on Auggie's markdown rendering
      const sizes = ['text-2xl', 'text-xl', 'text-lg', 'text-base', 'text-sm', 'text-xs'];
      const weights = [
        'font-bold',
        'font-semibold',
        'font-semibold',
        'font-medium',
        'font-medium',
        'font-medium',
      ];
      const margins = [
        'mt-8 mb-4 first:mt-0',
        'mt-6 mb-3 first:mt-0',
        'mt-5 mb-3 first:mt-0',
        'mt-4 mb-2 first:mt-0',
        'mt-3 mb-2 first:mt-0',
        'mt-2 mb-1 first:mt-0',
      ];
      const tracking = ['tracking-tight', 'tracking-tight', 'tracking-tight', '', '', ''];
      // Add a subtle gradient for h1 and h2
      const extraClass =
        depth <= 2
          ? 'bg-gradient-to-r from-foreground to-foreground/80 bg-clip-text text-transparent'
          : '';

      return `<h${depth} class="${sizes[depth - 1]} ${weights[depth - 1]} ${margins[depth - 1]} ${tracking[depth - 1]} ${extraClass} leading-tight">${text}</h${depth}>`;
    }

    codespan({ text }: Tokens.Codespan) {
      return `<code class="px-1.5 py-0.5 rounded bg-muted text-primary text-sm font-mono">${text}</code>`;
    }

    link({ href, title, text }: Tokens.Link) {
      const titleAttr = title ? ` title="${title}"` : '';
      return `<a href="${href}"${titleAttr} class="text-primary border-b border-transparent hover:border-primary transition-colors">${text}</a>`;
    }

    blockquote({ text }: Tokens.Blockquote) {
      return `<blockquote class="border-l-4 border-primary/40 pl-4 py-2.5 my-4 text-subtle italic bg-muted/30 rounded-r">${text}</blockquote>`;
    }

    list(token: Tokens.List) {
      const tag = token.ordered ? 'ol' : 'ul';
      const startAttr = token.ordered && token.start !== 1 ? ` start="${token.start}"` : '';
      const listClass = token.ordered ? 'list-decimal' : 'list-disc';
      return `<${tag}${startAttr} class="${listClass} pl-6 my-3 space-y-2 text-foreground">${token.items}</${tag}>`;
    }

    listitem(token: Tokens.ListItem) {
      if (token.task) {
        const checkboxClass = token.checked ? 'text-success' : 'text-muted-foreground';
        const checkIcon = token.checked ? '✓' : '○';
        return `<li class="flex items-start gap-2 leading-relaxed"><span class="${checkboxClass} font-bold text-base">${checkIcon}</span><span class="flex-1">${token.text}</span></li>`;
      }
      return `<li class="leading-relaxed">${token.text}</li>`;
    }

    paragraph({ text }: Tokens.Paragraph) {
      return `<p class="mb-4 last:mb-0 leading-relaxed text-foreground">${text}</p>`;
    }

    strong({ text }: Tokens.Strong) {
      return `<strong class="font-semibold text-foreground">${text}</strong>`;
    }

    em({ text }: Tokens.Em) {
      return `<em class="italic text-foreground">${text}</em>`;
    }

    hr() {
      return '<hr class="my-6 border-t border-border" />';
    }

    table({ header, rows }: Tokens.Table) {
      return `
				<div class="my-4 overflow-x-auto">
					<table class="min-w-full border border-border rounded-lg overflow-hidden">
						<thead class="bg-muted/50">
							${header}
						</thead>
						<tbody class="divide-y divide-border">
							${rows}
						</tbody>
					</table>
				</div>
			`;
    }

    tablerow({ text }: Tokens.TableRow) {
      return `<tr class="hover:bg-muted/30 transition-colors">${text}</tr>`;
    }

    tablecell({ text, header, align }: Tokens.TableCell) {
      const tag = header ? 'th' : 'td';
      const alignClass = align ? `text-${align}` : '';
      const paddingClass = 'px-4 py-2';
      const weightClass = header ? 'font-semibold' : '';
      return `<${tag} class="${paddingClass} ${alignClass} ${weightClass}">${text}</${tag}>`;
    }
  }

  // Process markdown content
  $effect(() => {
    try {
      // Clear the code blocks map for fresh parsing
      codeBlocksMap.clear();

      const renderer = new CustomRenderer();

      marked.use({
        renderer,
        breaks: true,
        gfm: true,
      });

      const html = marked.parse(content) as string;

      // Create blocks array with HTML and code blocks
      const parts = html.split(/<div data-code-block="([^"]+)"><\/div>/);
      const newBlocks: RenderedBlock[] = [];

      for (let i = 0; i < parts.length; i++) {
        if (i % 2 === 0) {
          // HTML content
          if (parts[i].trim()) {
            newBlocks.push({
              type: 'html',
              content: parts[i],
            });
          }
        } else {
          // Code block placeholder - get from map
          const codeBlock = codeBlocksMap.get(parts[i]);
          if (codeBlock) {
            newBlocks.push(codeBlock);
          }
        }
      }
      blocks = newBlocks;
    } catch (err) {
      logger.error('Markdown parse error:', err);
      blocks = [
        {
          type: 'html',
          content: content,
        },
      ];
    }
  });

  /** Intercept clicks on <a> tags and route through the unified link handler */
  async function handleContainerClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    const anchor = target.closest('a');
    if (!anchor?.href) return;

    // Let intent:// links and non-http links pass through
    const href = anchor.href;
    if (!href.startsWith('http://') && !href.startsWith('https://')) return;

    event.preventDefault();
    event.stopPropagation();
    await handleLink(href, { workspaceId: $activeWorkspaceId ?? undefined, event });
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="prose prose-sm max-w-none text-foreground {className}" onclick={handleContainerClick}>
  {#each blocks as block, blockIndex (`block-${blockIndex}-${block.type}`)}
    {#if block.type === 'augment-snippet'}
      <AugmentCodeSnippet
        code={block.content}
        language={block.language || 'plaintext'}
        path={block.path || ''}
        mode={block.mode || 'EXCERPT'}
        showLineNumbers={true}
        {onOpenFile}
      />
    {:else if block.type === 'mermaid'}
      <MermaidRenderer code={block.content} />
    {:else if block.type === 'diff'}
      <DiffViewer patch={withSyntheticDiffHeaders(block.content)} fileName="diff.patch" showHeader={false} />
    {:else if block.type === 'code'}
      <CodeBlock code={block.content} language={block.language || 'plaintext'} />
    {:else}
      <div
        class="prose-headings:text-foreground prose-strong:font-semibold prose-strong:text-foreground prose-em:italic prose-pre:m-0 prose-pre:bg-transparent prose-pre:p-0 prose-code:font-mono prose-code:text-sm"
      >
        {@html block.content}
      </div>
    {/if}
  {/each}
</div>
