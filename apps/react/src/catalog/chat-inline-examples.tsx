// i18n-ignore (internal catalog caller inputs and observations, not released product copy)
import { useState, type ReactNode } from 'react';
import { FormField } from '@/components/patterns/form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { InlineMarkdownSnippet } from '@/features/chat/components/inline-markdown-snippet';
import { McpIcon } from '@/features/settings/mcp/mcp-icon';

function TextField({
  label,
  value,
  onChange,
  multiline = false,
  numeric = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  numeric?: boolean;
}) {
  return (
    <FormField
      label={label}
      control={(field) =>
        multiline ? (
          <Textarea
            {...field}
            rows={5}
            value={value}
            onChange={(event) => onChange(event.target.value)}
          />
        ) : (
          <Input
            {...field}
            type={numeric ? 'number' : 'text'}
            step={numeric ? 'any' : undefined}
            value={value}
            onChange={(event) => onChange(event.target.value)}
          />
        )
      }
    />
  );
}

function Exercise({
  id,
  name,
  controls,
  inputs,
  children,
}: {
  id: string;
  name: string;
  controls: ReactNode;
  inputs: unknown;
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(true);
  const [revision, setRevision] = useState(0);
  return (
    <section
      className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3"
      aria-label={`${name} exercise`}
      data-testid={id}
    >
      <h3>{name}</h3>
      {controls}
      <div className="flex min-w-0 flex-wrap items-end gap-3">
        <FormField
          label={`Mount ${name}`}
          control={(field) => (
            <Switch
              {...field}
              ariaLabel={`Mount ${name}`}
              checked={mounted}
              onCheckedChange={setMounted}
            />
          )}
        />
        <Button disabled={!mounted} onClick={() => setRevision((current) => current + 1)}>
          Remount {name}
        </Button>
      </div>
      <div className="min-h-8 w-full min-w-0 max-w-[420px]" data-testid={`${id}-frame`}>
        {mounted && (
          <div key={revision} className="min-w-0" data-testid={`${id}-leaf`}>
            {children}
          </div>
        )}
      </div>
      <pre
        className="min-w-0 whitespace-pre-wrap wrap-anywhere"
        aria-label={`${name} caller state`}
        data-testid={`${id}-state`}
      >
        {JSON.stringify({ mounted, revision, inputs }, null, 2)}
      </pre>
    </section>
  );
}

function optionalNumber(value: string): number | undefined {
  return value.trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : undefined;
}

function MarkdownExercise() {
  const [content, setContent] = useState(
    '**strong** _emphasis_ `code` [readable label](https://example.com) &amp; \\*literal\\*',
  );
  const [limit, setLimit] = useState('');
  const [className, setClassName] = useState('');
  const inputs = {
    content,
    maxVisibleCharacters: optionalNumber(limit),
    className,
    testId: 'inline-markdown-content',
  };
  return (
    <Exercise
      id="inline-markdown"
      name="Inline Markdown"
      inputs={inputs}
      controls={
        <>
          <TextField label="Markdown content" multiline value={content} onChange={setContent} />
          <TextField
            label="Maximum visible characters, blank for default"
            numeric
            value={limit}
            onChange={setLimit}
          />
          <TextField label="Markdown caller classes" value={className} onChange={setClassName} />
          <p className="type-caption text-muted-foreground">
            The default limit is 80. Enter multiline Markdown, Unicode graphemes, or an empty value
            to exercise the shared inline projection. Zero, negative, and fractional limits go
            directly to the component.
          </p>
        </>
      }
    >
      <InlineMarkdownSnippet {...inputs} />
    </Exercise>
  );
}

function McpExercise() {
  const [iconName, setIconName] = useState('context7');
  const [draftIconName, setDraftIconName] = useState('context7');
  const [label, setLabel] = useState('Context7');
  const [size, setSize] = useState('');
  const [className, setClassName] = useState('');
  const inputs = { iconName, label, size: optionalNumber(size), className };
  return (
    <Exercise
      id="inline-mcp"
      name="MCP icon"
      inputs={inputs}
      controls={
        <>
          <TextField label="Icon name" value={draftIconName} onChange={setDraftIconName} />
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => setIconName(draftIconName)}>Apply icon name</Button>
          </div>
          <p className="type-caption text-muted-foreground">
            Context7 and Slack use inline artwork. Brain, server, database, cloud, and default use
            local icons; unknown names use the label initial. Applying GitHub, Figma, or Playwright
            requests the component’s production image URL. The initial icon does not request an
            external image.
          </p>
          <TextField label="Icon label" value={label} onChange={setLabel} />
          <TextField label="Icon size, blank for default" numeric value={size} onChange={setSize} />
          <TextField label="MCP caller classes" value={className} onChange={setClassName} />
        </>
      }
    >
      <McpIcon {...inputs} />
    </Exercise>
  );
}

export function ChatInlineExamples() {
  return (
    <section
      className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-8"
      aria-label="Chat inline examples"
      data-functional-example="chat-inline"
    >
      <p className="type-caption text-muted-foreground" data-internal-example>
        Internal migration exercise. Native behavior, source appearance parity, and product
        integration remain unverified. Use the catalog theme controls or theme URL parameter.
      </p>
      <MarkdownExercise />
      <McpExercise />
    </section>
  );
}
