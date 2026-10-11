// Source: src/routes/sandbox/recipes/RecipeSection.svelte.
// i18n-ignore (source-preserving internal design system recipe content)
import { useState, type ReactNode } from 'react';
import { notify } from '@/components/patterns/notify';
import { Button } from '@/components/ui/button';

export interface RecipeSectionProps {
  title: string;
  description: string;
  source: string;
  children: ReactNode;
}

export function RecipeSection({ title, description, source, children }: RecipeSectionProps) {
  const [copied, setCopied] = useState(false);

  async function copySource() {
    try {
      await navigator.clipboard.writeText(source);
      setCopied(true);
    } catch {
      setCopied(false);
      notify.error('Could not copy source.');
    }
  }

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card shadow-(--elevation-raised)">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <h2 className="type-title">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        <Button variant="outline" size="sm" onClick={copySource}>
          {copied ? 'Copied' : 'Copy source'}
        </Button>
      </header>
      <div className="min-w-0 bg-background p-5">{children}</div>
      <details className="border-t border-border">
        <summary className="cursor-pointer px-5 py-3 text-sm font-medium hover:bg-hover">
          View source
        </summary>
        <pre className="overflow-x-auto border-t border-border bg-muted p-4 text-xs">
          <code>{source}</code>
        </pre>
      </details>
    </section>
  );
}

export default RecipeSection;
