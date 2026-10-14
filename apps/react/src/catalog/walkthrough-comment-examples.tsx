// i18n-ignore (internal unreleased component preview controls and sample content)
import { useState } from 'react';
import { WalkthroughInlineComment } from '@/components/code-review/walkthrough/walkthrough-inline-comment';
import { Button } from '@/components/ui/button';

export function WalkthroughCommentExamples() {
  const [mounted, setMounted] = useState(true);
  const [busy, setBusy] = useState(false);
  const [alternate, setAlternate] = useState(false);
  const [calls, setCalls] = useState<{ message: string; line: number; file: string }[]>([]);
  const [closes, setCloses] = useState(0);
  return (
    <section className="grid min-w-0 w-full max-w-lg gap-4" data-testid="walkthrough-comment-demo">
      <h2>Inline code comment</h2>
      <div className="min-w-0" data-testid="walkthrough-comment-frame">
        {mounted && (
          <WalkthroughInlineComment
            lineNumber={alternate ? 88 : 42}
            fileName={alternate ? 'src/review.ts' : 'src/app.ts'}
            isSending={busy}
            onSend={(message, line, file) => setCalls([...calls, { message, line, file }])}
            onClose={() => setCloses(closes + 1)}
          />
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" aria-pressed={busy} onClick={() => setBusy(!busy)}>
          Sending
        </Button>
        <Button variant="outline" aria-pressed={alternate} onClick={() => setAlternate(!alternate)}>
          Change location
        </Button>
        <Button variant="outline" aria-pressed={mounted} onClick={() => setMounted(!mounted)}>
          Show comment
        </Button>
      </div>
      <output
        aria-label="Inline comment sends"
        className="type-caption min-w-0 break-words text-muted-foreground"
      >
        {JSON.stringify(calls)}
      </output>
      <output
        aria-label="Inline comment close requests"
        className="type-caption text-muted-foreground"
      >
        {closes}
      </output>
    </section>
  );
}
