// Source: src/lib/components/chat/InlineMarkdownSnippet.svelte.
import { useEffect, useState } from 'react';
import { renderInlineMarkdownSnippet } from '$lib/components/chat/inline-markdown-snippet';
import './inline-markdown-snippet.css';

export interface InlineMarkdownSnippetProps {
  content: string;
  maxVisibleCharacters?: number;
  className?: string;
  testId?: string;
}

export function InlineMarkdownSnippet({
  content,
  maxVisibleCharacters = 80,
  className = '',
  testId,
}: InlineMarkdownSnippetProps) {
  const [inlineHTML, setInlineHTML] = useState('');

  useEffect(() => {
    let cancelled = false;
    void renderInlineMarkdownSnippet(content, maxVisibleCharacters).then((html) => {
      if (!cancelled) setInlineHTML(html);
    });
    return () => {
      cancelled = true;
    };
  }, [content, maxVisibleCharacters]);

  // The shared Markdown pipeline sanitizes this strict inline-only projection.
  return (
    <span
      className={`inline-markdown-snippet intent-inline-markdown-snippet ${className}`}
      data-inline-markdown-snippet=""
      data-testid={testId}
      dangerouslySetInnerHTML={{ __html: inlineHTML }}
    />
  );
}

export default InlineMarkdownSnippet;
