import { useLayoutEffect, useMemo, useState } from 'react';
import { clsx } from 'clsx';
import { CopyButton } from '@/components/ui/copy-button';
import { escapeCodeHtml, getCachedHighlight, highlightAsync } from '$lib/utils/code-highlighter';
import '$lib/styles/syntax-highlighting.css';
import '$lib/styles/code-block.css';

export interface CodeBlockProps {
  code?: string;
  language?: string;
  showLineNumbers?: boolean;
  startLineNumber?: number;
  highlightLines?: number[];
  /** Accepted for source compatibility; neither filename prop renders a header. */
  fileName?: string;
  filename?: string;
  maxHeight?: number;
  /** Hide the border around the code block. */
  noBorder?: boolean;
  /** Remove top and bottom margins. */
  noMargin?: boolean;
  doScroll?: boolean;
  className?: string;
}

export function CodeBlock({
  code = '',
  language = 'plaintext',
  showLineNumbers = false,
  startLineNumber = 1,
  highlightLines = [],
  fileName: _fileName = '',
  filename: _filename = '',
  maxHeight = undefined,
  noBorder = false,
  noMargin = false,
  doScroll = true,
  className = '',
}: CodeBlockProps) {
  // Cache hits or escaped plain text are available on the first render of each
  // input. An old async result must never show text from a previous streaming chunk.
  const input = useMemo(() => {
    const cached = getCachedHighlight(code, language);
    return { code, language, cached: cached !== null, html: cached ?? escapeCodeHtml(code) };
  }, [code, language]);
  const [result, setResult] = useState<{ input: typeof input; html: string } | null>(null);
  const highlighted = result?.input === input ? result.html : input.html;

  useLayoutEffect(() => {
    if (input.cached) return;

    // Cleanup marks superseded/unmounted work stale before the next idle callback;
    // the canonical helper can skip highlighting when all its callers are stale.
    let stale = false;
    highlightAsync(input.code, input.language, () => stale).then((html) => {
      if (!stale) setResult({ input, html });
    });
    return () => {
      stale = true;
    };
  }, [input]);

  const lines = highlighted.split('\n');
  // Svelte class directives override the same tokens supplied through className.
  const callerClasses = className
    .split(/[\t\n\f\r ]+/)
    .filter((name) => !['mt-3', 'mb-5', 'no-border'].includes(name));

  return (
    <div
      className={clsx(
        'code-block-container intent-code-block group rounded-md overflow-hidden relative',
        callerClasses,
        { 'mt-3': !noMargin, 'mb-5': !noMargin, 'no-border': noBorder },
      )}
      style={maxHeight ? { maxHeight, overflowY: 'auto' } : undefined}
    >
      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
        <CopyButton
          text={code}
          size="xs"
          className="bg-background/80 hover:bg-hover text-muted-foreground hover:text-foreground backdrop-blur-sm"
        />
      </div>
      <div className="flex">
        {showLineNumbers && (
          <div className="line-numbers-gutter intent-code-block select-none text-right flex-shrink-0 py-3 pl-3 pr-2">
            {lines.map((_, index) => {
              const lineNumber = startLineNumber + index;
              return (
                <div
                  key={lineNumber}
                  className={clsx('line-number intent-code-block', {
                    highlighted: highlightLines.includes(lineNumber),
                  })}
                >
                  {lineNumber}
                </div>
              );
            })}
          </div>
        )}
        <div className={clsx('flex-1', { 'overflow-x-auto': doScroll })}>
          <pre
            className={clsx('code-pre intent-code-block py-3 pr-3 bg-background!', {
              'pl-3': !showLineNumbers,
            })}
          >
            <code className={`hljs intent-code-block language-${language}`}>
              {lines.map((line, index) => (
                <div
                  key={index}
                  className={clsx('code-line intent-code-block', {
                    highlighted: highlightLines.includes(startLineNumber + index),
                  })}
                  dangerouslySetInnerHTML={{ __html: line || ' ' }}
                />
              ))}
            </code>
          </pre>
        </div>
      </div>
    </div>
  );
}
