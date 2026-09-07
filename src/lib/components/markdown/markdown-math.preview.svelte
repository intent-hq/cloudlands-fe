<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  export interface MarkdownMathPreviewProps {
    isStreaming?: boolean;
    dense?: boolean;
  }

  export const preview = definePreview<MarkdownMathPreviewProps>({
    id: 'markdown-math',
    title: 'Markdown math',
    defaultState: 'complete',
    states: {
      complete: { props: {} },
      streaming: { props: { isStreaming: true } },
      narrow: { props: { dense: true } },
    },
  });
</script>

<script lang="ts">
  import type { ContentBlock } from '$shared/types';
  import MessageContent from '$lib/components/chat/MessageContent.svelte';
  import MarkdownViewer from './MarkdownViewer.svelte';

  let { isStreaming = false, dense = false }: MarkdownMathPreviewProps = $props();

  const chatContent: ContentBlock[] = [
    {
      type: 'text',
      text: String.raw`The inline identity $e^{i\pi}+1=0$ stays aligned with prose.

$$\frac{-b \pm \sqrt{b^2-4ac}}{2a}$$`,
    },
  ];
  const noteContent =
    String.raw`## Read-only Markdown

Fractions $\frac{1}{2}$, roots \(\sqrt{x}\), Unicode α + β, and adjacent formulas $x^2$ $y^2$.

| Source | Result |
| --- | --- |
| Matrix | $\begin{pmatrix}a&b\\c&d\end{pmatrix}$ |

$$\sum_{n=1}^{\infty}\frac{1}{n^2}=\frac{\pi^2}{6}\qquad(x_1+y_1+z_1)(x_2+y_2+z_2)(x_3+y_3+z_3)(x_4+y_4+z_4)$$` +
    '\n\nCode stays literal: `$not-math$`. A price stays literal: Costs $5 and $10.';
</script>

<section class:dense class="grid gap-5" data-testid="markdown-math-preview">
  <article class="surface" data-testid="completed-chat-math">
    <h2>Completed chat</h2>
    <MessageContent content={chatContent} {isStreaming} role="assistant" />
  </article>
  <article class="surface" data-testid="read-only-markdown-math">
    <h2>Read-only Markdown file</h2>
    <MarkdownViewer content={noteContent} renderRichFencesAsCode />
  </article>
</section>

<style>
  .surface {
    min-width: 0;
    overflow: hidden;
    border: 1px solid hsl(var(--border));
    border-radius: 0.5rem;
    padding: 1rem;
    background: hsl(var(--background));
  }
  h2 {
    margin-bottom: 0.75rem;
    font-size: var(--text-title-size);
    font-weight: var(--text-title-weight);
  }
  .dense {
    max-width: 17rem;
  }
</style>
