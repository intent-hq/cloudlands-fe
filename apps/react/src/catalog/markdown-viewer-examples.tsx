// i18n-ignore (internal, unreleased catalog controls and caller observations)
import { useCallback, useEffect, useRef, useState } from 'react';
import { MarkdownViewer, type MarkdownViewerProps } from '@/components/markdown/markdown-viewer';
import { FormField } from '@/components/patterns/form';
import { Button } from '@/components/ui/button';
import { FileInput } from '@/components/ui/file-input';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { CUSTOM_WORKBENCH_CASES } from '$lib/components/diagrams/diagram-workbench.preview-fixtures';
import { WorkspaceId } from '$shared/types/branded-ids';
import type { TextBlockMedia } from '$shared/types/content-block';

// Raw inputs only: the production viewer owns parsing, sanitization and rendering.
const samples = {
  plain: 'Plain text with a second line.\nNo Markdown formatting.',
  formatted:
    '# Local Markdown\n\nA **strong** and *emphasized* paragraph with `inline code`.\n\n> A local quotation.\n\n- First item\n- Second item\n\n| Item | Count |\n| --- | ---: |\n| Apples | 2 |\n\n```ts\nconst greeting = "Hello";\nconsole.log(greeting);\n```\n\nInline math $x^2 + y^2 = z^2$.\n\n$$\n\\sum_{n=1}^{3} n = 6\n$$',
  links:
    '[Relative file](src/main.ts)\n\n[File with line](intent://local/file/docs/report%20%231.pdf#L8)\n\n[Local note](intent://local/note/spec)\n\n[Web link](https://example.com/markdown)',
  mentions:
    'File mention: @src/a.ts:10\n\nBare file: docs/chl-spec.md:2471\n\nNote mention: @note/spec',
  html: '<details><summary>Local details</summary><p>Safe <strong>HTML</strong> content.</p></details>\n\n<script>throw new Error("Sanitization sample must remain inert")</script>',
  tasks:
    '- [ ] Open task\n- [x] Completed task\n\n@@@task\n# Local task draft\nRead the local Markdown sample.\n@@@',
  'rich fences':
    '```ws-block:cli\n{"command":"pwd","description":"Show working directory"}\n```\n\n```ws-block:reference\n{"filePath":"src/main.ts","description":"Local source"}\n```\n\n```nav-link\n{"target":"intent://local/note/spec","label":"Local note"}\n```',
  mermaid: '```mermaid\nflowchart LR\n  Start --> Finish\n```',
  diagram: `\`\`\`ws-block:diagram\n${JSON.stringify(CUSTOM_WORKBENCH_CASES['custom-architecture'].diagram, null, 2)}\n\`\`\``,
};
const flagNames = [
  'isStreaming',
  'allowFileMedia',
  'chatImageThumbnails',
  'forceExternalLinks',
  'renderRichFencesAsCode',
  'renderDiagrams',
  'allowSanitizedHtml',
] as const;
type FlagName = (typeof flagNames)[number];
type OptionalBoolean = 'omit' | 'true' | 'false';
type CallbackName =
  | 'onOpenLink'
  | 'onOpenFile'
  | 'onOpenNote'
  | 'onFileClick'
  | 'onCodeBlockAction'
  | 'canOpenFile';
const callbackNames: CallbackName[] = [
  'onOpenLink',
  'onOpenFile',
  'onOpenNote',
  'onFileClick',
  'onCodeBlockAction',
  'canOpenFile',
];
type Observation = Record<string, unknown>;

function TextField({
  label,
  value,
  onChange,
  multiline = false,
  error,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  error?: string;
}) {
  return (
    <FormField
      label={label}
      error={error}
      control={(field) =>
        multiline ? (
          <Textarea
            {...field}
            rows={6}
            value={value}
            onChange={(event) => onChange(event.currentTarget.value)}
          />
        ) : (
          <Input
            {...field}
            value={value}
            onChange={(event) => onChange(event.currentTarget.value)}
          />
        )
      }
    />
  );
}

function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <FormField
      label={label}
      control={(field) => (
        <Switch {...field} ariaLabel={label} checked={value} onCheckedChange={onChange} />
      )}
    />
  );
}

function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly T[];
  onChange: (value: T) => void;
}) {
  return (
    <FormField
      label={label}
      control={(field) => (
        <ToggleGroup
          {...field}
          type="single"
          aria-label={label}
          value={value}
          className="min-w-0 flex-wrap justify-start"
          onValueChange={(next) => {
            const selected = options.find((option) => option === next);
            if (selected) onChange(selected);
          }}
        >
          {options.map((option) => (
            <ToggleGroupItem key={option} value={option}>
              {option}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      )}
    />
  );
}

function Output({ label, value }: { label: string; value: unknown }) {
  return (
    <output
      aria-label={label}
      className="block max-h-64 min-w-0 max-w-full overflow-auto whitespace-pre-wrap wrap-anywhere"
    >
      {JSON.stringify(value, (_key, entry) => (entry === undefined ? '[undefined]' : entry), 2)}
    </output>
  );
}

function describeElement(target: EventTarget | null) {
  if (!(target instanceof Element)) return null;
  return {
    tag: target.tagName,
    id: target.id,
    testId: target.getAttribute('data-testid'),
    role: target.getAttribute('role'),
    rawHref: target.closest('a')?.getAttribute('href') ?? null,
    closestPanel: target.closest('[data-panel-id]')?.getAttribute('data-panel-id') ?? null,
  };
}

function useObservations() {
  const records = useRef({
    counts: {} as Record<string, number>,
    callbacks: [] as Observation[],
    admission: [] as Observation[],
    native: [] as Observation[],
  });
  const identities = useRef({ next: 0, objects: new WeakMap<object, number>() });
  const captured = useRef<Event | null>(null);
  const [observations, setObservations] = useState({
    revision: 0,
    counts: {} as Record<string, number>,
    callbacks: [] as Observation[],
    admission: [] as Observation[],
    native: [] as Observation[],
  });
  const objectId = useCallback((object: object) => {
    let id = identities.current.objects.get(object);
    if (id === undefined) {
      id = ++identities.current.next;
      identities.current.objects.set(object, id);
    }
    return id;
  }, []);
  const snapshot = useCallback(
    (event: Event) => ({
      objectId: objectId(event),
      type: event.type,
      isTrusted: event.isTrusted,
      currentTarget: describeElement(event.currentTarget),
      target: describeElement(event.target),
      eventPhase: event.eventPhase,
      defaultPrevented: event.defaultPrevented,
      cancelBubble: event.cancelBubble,
      sameAsCapturedEvent: event === captured.current,
      ...(event instanceof MouseEvent
        ? { button: event.button, buttons: event.buttons, detail: event.detail }
        : {}),
      ...(event instanceof KeyboardEvent
        ? { key: event.key, code: event.code, repeat: event.repeat }
        : {}),
      ...(event instanceof MouseEvent || event instanceof KeyboardEvent
        ? {
            ctrlKey: event.ctrlKey,
            metaKey: event.metaKey,
            altKey: event.altKey,
            shiftKey: event.shiftKey,
          }
        : {}),
    }),
    [objectId],
  );
  const record = useCallback(
    (
      name: CallbackName,
      callbackRevision: number,
      mountRevision: number,
      args: unknown[],
      result?: boolean,
    ) => {
      function snapshotArgument(argument: unknown): unknown {
        if (argument instanceof Event) return snapshot(argument);
        if (typeof argument === 'function')
          return { type: 'function', objectId: objectId(argument) };
        if (Array.isArray(argument)) return argument.map(snapshotArgument);
        if (argument && typeof argument === 'object')
          return Object.fromEntries(
            Object.entries(argument).map(([key, value]) => [key, snapshotArgument(value)]),
          );
        return argument;
      }
      const observation = {
        name,
        callbackRevision,
        mountRevision,
        argumentCount: args.length,
        arguments: args.map(snapshotArgument),
        result,
        ...(['onOpenFile', 'onOpenNote', 'onFileClick'].includes(name)
          ? { capturedEvent: captured.current ? snapshot(captured.current) : null }
          : {}),
      };
      const current = records.current;
      current.counts[name] = (current.counts[name] ?? 0) + 1;
      const lane = name === 'canOpenFile' ? 'admission' : 'callbacks';
      current[lane] = [...current[lane].slice(-19), observation];
      // canOpenFile can run during child render. Recording must never schedule a render.
    },
    [objectId, snapshot],
  );
  const frameRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node) return;
      const cleanups = [
        'click',
        'pointerdown',
        'keydown',
        'keyup',
        'contextmenu',
        'copy',
        'focusin',
      ].flatMap((type) =>
        [true, false].map((capture) => {
          const listener = (event: Event) => {
            if (capture) captured.current = event;
            const name = `${type}-${capture ? 'capture' : 'bubble'}`;
            const current = records.current;
            current.counts[name] = (current.counts[name] ?? 0) + 1;
            current.native = [...current.native.slice(-23), { name, ...snapshot(event) }];
          };
          node.addEventListener(type, listener, { capture, passive: true });
          return () => node.removeEventListener(type, listener, capture);
        }),
      );
      return () => {
        cleanups.forEach((cleanup) => cleanup());
        captured.current = null;
      };
    },
    [snapshot],
  );
  return {
    record,
    frameRef,
    observations,
    refresh: () => {
      const next = { ...records.current, counts: { ...records.current.counts } };
      setObservations((current) => ({ revision: current.revision + 1, ...next }));
    },
    clear: () => {
      records.current = { counts: {}, callbacks: [], admission: [], native: [] };
      captured.current = null;
      const next = { ...records.current, counts: {} };
      setObservations((current) => ({ revision: current.revision + 1, ...next }));
    },
  };
}

type PastedFile = { name: string; type: string; size: number; dataUrl?: string; error?: string };
type PasteReceipt = {
  sequence: number;
  event: {
    type: string;
    isTrusted: boolean;
    currentTarget: ReturnType<typeof describeElement>;
    target: ReturnType<typeof describeElement>;
    control: ReturnType<typeof describeElement>;
  };
  types: string[];
  items: { kind: string; type: string }[];
  text: string;
  files: PastedFile[];
};

function ClipboardPasteTarget() {
  const [text, setText] = useState('');
  const [receipts, setReceipts] = useState<PasteReceipt[]>([]);
  const sequence = useRef(0);
  const readers = useRef(new Set<FileReader>());
  useEffect(() => {
    const activeReaders = readers.current;
    return () => {
      for (const reader of activeReaders) reader.abort();
      activeReaders.clear();
    };
  }, []);
  return (
    <>
      <FormField
        label="Paste copied image here"
        description="Paste using the native clipboard. Image receipts contain exact FileReader data URLs; text paste remains ordinary textarea input."
        control={(field) => (
          <Textarea
            {...field}
            data-testid="markdown-viewer-paste-target"
            rows={3}
            value={text}
            onChange={(event) => setText(event.currentTarget.value)}
            onPaste={(event) => {
              const id = ++sequence.current;
              const files = Array.from(event.clipboardData.files);
              const receipt: PasteReceipt = {
                sequence: id,
                event: {
                  type: event.nativeEvent.type,
                  isTrusted: event.nativeEvent.isTrusted,
                  currentTarget: describeElement(event.nativeEvent.currentTarget),
                  target: describeElement(event.nativeEvent.target),
                  control: describeElement(event.currentTarget),
                },
                types: Array.from(event.clipboardData.types),
                items: Array.from(event.clipboardData.items, (item) => ({
                  kind: item.kind,
                  type: item.type,
                })),
                text: event.clipboardData.getData('text/plain'),
                files: files.map((file) => ({ name: file.name, type: file.type, size: file.size })),
              };
              setReceipts((current) => [...current.slice(-5), receipt]);
              files.forEach((file, index) => {
                if (!file.type.startsWith('image/')) return;
                const reader = new FileReader();
                readers.current.add(reader);
                const complete = (result: Pick<PastedFile, 'dataUrl' | 'error'>) => {
                  if (!readers.current.delete(reader)) return;
                  setReceipts((current) =>
                    current.map((entry) =>
                      entry.sequence === id
                        ? {
                            ...entry,
                            files: entry.files.map((item, fileIndex) =>
                              fileIndex === index ? { ...item, ...result } : item,
                            ),
                          }
                        : entry,
                    ),
                  );
                };
                reader.onload = () =>
                  complete(
                    typeof reader.result === 'string'
                      ? { dataUrl: reader.result }
                      : { error: 'FileReader returned no data URL.' },
                  );
                reader.onerror = () =>
                  complete({ error: reader.error?.message ?? 'Pasted image could not be read.' });
                reader.readAsDataURL(file);
              });
            }}
          />
        )}
      />
      <Output label="Markdown clipboard receipts" value={receipts} />
    </>
  );
}

export function MarkdownViewerExamples() {
  const [draft, setDraft] = useState(samples.formatted);
  const [content, setContent] = useState(samples.formatted);
  const [changeMode, setChangeMode] = useState<'apply' | 'change'>('apply');
  const [flags, setFlags] = useState<Record<FlagName, OptionalBoolean>>({
    isStreaming: 'omit',
    allowFileMedia: 'false',
    chatImageThumbnails: 'omit',
    forceExternalLinks: 'omit',
    renderRichFencesAsCode: 'omit',
    renderDiagrams: 'omit',
    allowSanitizedHtml: 'omit',
  });
  const [taskMode, setTaskMode] = useState<'omit' | 'placeholder' | 'content'>('omit');
  const [className, setClassName] = useState('');
  const [supplyClass, setSupplyClass] = useState(false);
  const [workspace, setWorkspace] = useState('system-design');
  const [supplyWorkspace, setSupplyWorkspace] = useState(false);
  const [contextMode, setContextMode] = useState<'undefined' | 'null' | 'value'>('value');
  const [contextWorkspace, setContextWorkspace] = useState('system-design');
  const [panelId, setPanelId] = useState('markdown-viewer-panel');
  const [supplyPanel, setSupplyPanel] = useState(true);
  const [admission, setAdmission] = useState<OptionalBoolean>('omit');
  const [supplyFileCallback, setSupplyFileCallback] = useState(false);
  const [supplyCodeCallback, setSupplyCodeCallback] = useState(false);
  const [mediaDraft, setMediaDraft] = useState('{}');
  const [media, setMedia] = useState<TextBlockMedia>({});
  const [mediaError, setMediaError] = useState('');
  const [supplyMedia, setSupplyMedia] = useState(false);
  const [mounted, setMounted] = useState(true);
  const [mountRevision, setMountRevision] = useState(0);
  const [width, setWidth] = useState('420');
  const [revisions, setRevisions] = useState<Record<CallbackName, number>>({
    onOpenLink: 0,
    onOpenFile: 0,
    onOpenNote: 0,
    onFileClick: 0,
    onCodeBlockAction: 0,
    canOpenFile: 0,
  });
  const { record, frameRef, observations, refresh, clear } = useObservations();
  const onOpenLink = useCallback<MarkdownViewerProps['onOpenLink']>(
    (...args) => {
      record('onOpenLink', revisions.onOpenLink, mountRevision, args, true);
      return true;
    },
    [record, revisions.onOpenLink, mountRevision],
  );
  const onOpenFile = useCallback<MarkdownViewerProps['onOpenFile']>(
    (...args) => record('onOpenFile', revisions.onOpenFile, mountRevision, args),
    [record, revisions.onOpenFile, mountRevision],
  );
  const onOpenNote = useCallback<MarkdownViewerProps['onOpenNote']>(
    (...args) => record('onOpenNote', revisions.onOpenNote, mountRevision, args),
    [record, revisions.onOpenNote, mountRevision],
  );
  const onFileClick = useCallback<NonNullable<MarkdownViewerProps['onFileClick']>>(
    (...args) => record('onFileClick', revisions.onFileClick, mountRevision, args),
    [record, revisions.onFileClick, mountRevision],
  );
  const onCodeBlockAction = useCallback<NonNullable<MarkdownViewerProps['onCodeBlockAction']>>(
    (...args) => record('onCodeBlockAction', revisions.onCodeBlockAction, mountRevision, args),
    [record, revisions.onCodeBlockAction, mountRevision],
  );
  const canOpenFile = useCallback(() => {
    const allowed = admission === 'true';
    record('canOpenFile', revisions.canOpenFile, mountRevision, [], allowed);
    return allowed;
  }, [record, revisions.canOpenFile, mountRevision, admission]);

  const reader = useRef<FileReader | null>(null);
  const [localFile, setLocalFile] = useState<{
    name: string;
    mimeType: string;
    url: string;
  } | null>(null);
  const [reading, setReading] = useState(false);
  const [fileError, setFileError] = useState('');
  const [mediaUrl, setMediaUrl] = useState('');
  const [mediaLabel, setMediaLabel] = useState('Local media');
  useEffect(
    () => () => {
      const previous = reader.current;
      reader.current = null;
      previous?.abort();
    },
    [],
  );
  function readFile(files: FileList | undefined) {
    const previous = reader.current;
    reader.current = null;
    previous?.abort();
    setLocalFile(null);
    setMediaUrl('');
    setFileError('');
    const file = files?.[0];
    setReading(Boolean(file));
    if (!file) return;
    const next = new FileReader();
    reader.current = next;
    next.onload = () => {
      if (reader.current !== next) return;
      reader.current = null;
      setReading(false);
      if (typeof next.result !== 'string') return;
      setLocalFile({ name: file.name, mimeType: file.type, url: next.result });
      setMediaLabel(file.name);
      if (file.type.startsWith('image/')) setMediaUrl(next.result);
    };
    next.onerror = () => {
      if (reader.current !== next) return;
      reader.current = null;
      setReading(false);
      setFileError(next.error?.message ?? 'File could not be read.');
    };
    next.readAsDataURL(file);
  }
  function changeDraft(next: string) {
    setDraft(next);
    if (changeMode === 'change') setContent(next);
  }
  function appendMedia(linked: boolean) {
    const label = mediaLabel.replace(/[\\[\]]/g, '\\$&');
    // FileReader's base64 image URL needs no delimiter escaping; preserve other URL inputs.
    const destination =
      localFile?.mimeType.startsWith('image/') && mediaUrl === localFile.url
        ? mediaUrl
        : `<${mediaUrl}>`;
    const image = `![${label}](${destination})`;
    changeDraft(`${draft}\n\n${linked ? `[${image}](intent://local/note/spec)` : image}`);
  }
  function applyMedia() {
    try {
      const parsed: unknown = JSON.parse(mediaDraft);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
        throw new Error('Enter a JSON object keyed by the exact Markdown source URL.');
      // Pass entries unchanged. The canonical dimension helper decides which entries apply.
      setMedia(parsed as TextBlockMedia);
      setMediaError('');
    } catch (error) {
      setMediaError(error instanceof Error ? error.message : String(error));
    }
  }

  const booleanProps: Partial<Pick<MarkdownViewerProps, FlagName>> = {};
  for (const name of flagNames)
    if (flags[name] !== 'omit') booleanProps[name] = flags[name] === 'true';
  const workspaceContext =
    contextMode === 'undefined'
      ? undefined
      : { workspaceId: contextMode === 'null' ? null : WorkspaceId(contextWorkspace) };
  const optionalProps = {
    ...booleanProps,
    ...(taskMode === 'omit' ? {} : { taskBlockRenderMode: taskMode }),
    ...(supplyClass ? { className } : {}),
    ...(supplyWorkspace ? { workspaceId: workspace } : {}),
    ...(supplyFileCallback ? { onFileClick } : {}),
    ...(supplyCodeCallback ? { onCodeBlockAction } : {}),
    ...(admission === 'omit' ? {} : { canOpenFile }),
    ...(supplyMedia ? { media } : {}),
  };

  return (
    <section
      data-functional-example="markdown-viewer"
      aria-label="Markdown viewer exercise"
      className="grid min-w-0 gap-4"
    >
      <h2>Full Markdown viewer</h2>
      <p>
        Internal, unreleased exercise. Host callbacks record receipt only; they do not navigate.
        Rendering, media actions and diagrams belong to the viewer. Refresh observations after an
        interaction to read its native events and callback receipts.
      </p>
      <Choice
        label="Content update mode"
        value={changeMode}
        options={['apply', 'change']}
        onChange={setChangeMode}
      />
      <TextField label="Raw Markdown content" value={draft} onChange={changeDraft} multiline />
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setContent(draft)}>Apply Markdown content</Button>
        {Object.entries(samples).map(([name, sample]) => (
          <Button key={name} variant="outline" onClick={() => changeDraft(sample)}>
            Load {name} sample
          </Button>
        ))}
      </div>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        {flagNames.map((name) => (
          <Choice
            key={name}
            label={name}
            value={flags[name]}
            options={['omit', 'true', 'false']}
            onChange={(value) => setFlags((current) => ({ ...current, [name]: value }))}
          />
        ))}
        <Choice
          label="taskBlockRenderMode"
          value={taskMode}
          options={['omit', 'placeholder', 'content']}
          onChange={setTaskMode}
        />
        <Toggle label="Supply className" value={supplyClass} onChange={setSupplyClass} />
        <TextField label="className" value={className} onChange={setClassName} />
        <Choice
          label="workspaceContext"
          value={contextMode}
          options={['undefined', 'null', 'value']}
          onChange={setContextMode}
        />
        <TextField
          label="Context workspace ID"
          value={contextWorkspace}
          onChange={setContextWorkspace}
        />
        <Toggle
          label="Supply workspaceId override"
          value={supplyWorkspace}
          onChange={setSupplyWorkspace}
        />
        <TextField label="workspaceId override" value={workspace} onChange={setWorkspace} />
        <Toggle label="Supply source panel marker" value={supplyPanel} onChange={setSupplyPanel} />
        <TextField label="Source panel ID" value={panelId} onChange={setPanelId} />
        <Choice
          label="canOpenFile"
          value={admission}
          options={['omit', 'true', 'false']}
          onChange={setAdmission}
        />
        <Toggle
          label="Supply onFileClick"
          value={supplyFileCallback}
          onChange={setSupplyFileCallback}
        />
        <Toggle
          label="Supply onCodeBlockAction"
          value={supplyCodeCallback}
          onChange={setSupplyCodeCallback}
        />
      </div>
      <p>
        onCodeBlockAction is an optional source API; this caller does not manufacture code actions.
        Admission receipts count only real calls by the viewer.
      </p>
      <TextField
        label="Media sidecar JSON"
        value={mediaDraft}
        onChange={setMediaDraft}
        multiline
        error={mediaError}
      />
      <Toggle label="Supply media sidecar" value={supplyMedia} onChange={setSupplyMedia} />
      <Button onClick={applyMedia}>Apply media JSON</Button>
      <FileInput
        id="markdown-viewer-local-file"
        label="Read local image or video"
        accept="image/*,video/mp4,video/webm"
        busy={reading}
        error={fileError}
        onFilesChange={readFile}
      />
      <p>
        Selected images supply their FileReader data URL. For video playback, enter an existing
        canonical workspace file or asset URL. Selecting a video reads its bytes but does not upload
        it or invent a workspace path. In apply mode, insertions edit the draft until Apply Markdown
        content is pressed.
      </p>
      <TextField label="Media Markdown source URL" value={mediaUrl} onChange={setMediaUrl} />
      <TextField label="Media Markdown label" value={mediaLabel} onChange={setMediaLabel} />
      <div className="flex flex-wrap gap-2">
        <Button disabled={!mediaUrl} onClick={() => appendMedia(false)}>
          Insert media Markdown
        </Button>
        <Button disabled={!mediaUrl} onClick={() => appendMedia(true)}>
          Insert linked image Markdown
        </Button>
        <Button
          disabled={!localFile?.mimeType.startsWith('image/')}
          onClick={() => {
            if (localFile) setMediaUrl(localFile.url);
          }}
        >
          Use selected image URL
        </Button>
      </div>
      <Output
        label="Local file receipt"
        value={
          localFile
            ? {
                name: localFile.name,
                mimeType: localFile.mimeType,
                dataUrlLength: localFile.url.length,
              }
            : null
        }
      />
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <Toggle
          label="Mount Markdown viewer"
          value={mounted}
          onChange={(value) => {
            setMounted(value);
            if (value) setMountRevision((current) => current + 1);
          }}
        />
        <Choice
          label="Viewer frame width"
          value={width}
          options={['420', '720']}
          onChange={setWidth}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button disabled={!mounted} onClick={() => setMountRevision((current) => current + 1)}>
          Remount Markdown viewer
        </Button>
        {callbackNames.map((name) => (
          <Button
            key={name}
            variant="outline"
            onClick={() => setRevisions((current) => ({ ...current, [name]: current[name] + 1 }))}
          >
            Replace {name}
          </Button>
        ))}
      </div>
      <div
        ref={frameRef}
        data-testid="markdown-viewer-frame"
        data-panel-id={supplyPanel ? panelId : undefined}
        className="min-w-0 max-w-full"
        style={{ width: Number(width) }}
      >
        {mounted && (
          <MarkdownViewer
            key={mountRevision}
            content={content}
            workspaceContext={workspaceContext}
            onOpenLink={onOpenLink}
            onOpenFile={onOpenFile}
            onOpenNote={onOpenNote}
            {...optionalProps}
          />
        )}
        <Button data-testid="markdown-viewer-sibling">Unrelated sibling</Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={refresh}>Refresh observations</Button>
        <Button onClick={clear}>Clear observations</Button>
      </div>
      <Output
        label="Markdown caller inputs"
        value={{
          mounted,
          mountRevision,
          width,
          callbackRevisions: revisions,
          changeMode,
          workspaceContext,
          content,
          optionalProps: {
            ...optionalProps,
            ...(supplyFileCallback ? { onFileClick: 'supplied' } : {}),
            ...(supplyCodeCallback ? { onCodeBlockAction: 'supplied' } : {}),
            ...(admission === 'omit' ? {} : { canOpenFile: admission }),
          },
        }}
      />
      <Output label="Markdown observations" value={observations} />
      <ClipboardPasteTarget />
    </section>
  );
}
