// i18n-ignore (internal catalog caller inputs and observations, not released product copy)
import { useMemo, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { FormField } from '@/components/patterns/form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  QueuedMessageAttachments,
  type QueuedMessageAttachmentsProps,
} from '@/features/chat/components/queued-message-attachments';

type Message = QueuedMessageAttachmentsProps['message'];
type ImageBlock = NonNullable<Message['imageBlocks']>[number];
type FileBlock = NonNullable<Message['fileBlocks']>[number];
type Mode = 'empty' | 'images' | 'files' | 'mixed';

// Ordinary caller image data: two valid 4×4 RGBA PNGs. The real img decodes them.
const imageData = [
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAEklEQVR4nGNQmLDgPzJmIF0AANL4JPHDGowUAAAAAElFTkSuQmCC',
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAEklEQVR4nGNYEDDhPzJmIF0AAEOHJ/H2CiJQAAAAAElFTkSuQmCC',
];
const modes: Mode[] = ['empty', 'images', 'files', 'mixed'];

function BooleanField({
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

type ParentObservation = {
  phase: 'click-capture' | 'click-bubble' | 'pointer-capture' | 'pointer-bubble';
  targetTag: string | null;
  buttonTestId: string | null;
  trusted: boolean;
};
type CallbackObservation = {
  kind: 'image' | 'file' | 'image-error';
  callbackRevision: number;
  resolverRevision: number;
  mountRevision: number;
  block: ImageBlock | FileBlock;
  sameBlock: boolean;
  index: number;
  opener?: {
    isButton: boolean;
    sameAsIndexedButton: boolean;
    sameAsCapturedButton: boolean;
    contained: boolean;
    connected: boolean;
    tagName: string;
    testId: string | null;
    slot: string | null;
    capturedClickTrusted: boolean;
  };
  src?: string;
};

export function QueuedAttachmentExamples() {
  const [mode, setMode] = useState<Mode>('mixed');
  const [imageCount, setImageCount] = useState(3);
  const [fileCount, setFileCount] = useState(4);
  const [fileName, setFileName] = useState('queued-attachment-with-a-long-name');
  const [blockRevision, setBlockRevision] = useState(0);
  const [reversed, setReversed] = useState(false);
  const [nullSource, setNullSource] = useState(false);
  const [resolverRevision, setResolverRevision] = useState(0);
  const [callbackRevision, setCallbackRevision] = useState(0);
  const [mounted, setMounted] = useState(true);
  const [mountRevision, setMountRevision] = useState(0);
  const [observations, setObservations] = useState<{
    parentCount: number;
    callbackCount: number;
    parent: ParentObservation[];
    callbacks: CallbackObservation[];
  }>({ parentCount: 0, callbackCount: 0, parent: [], callbacks: [] });
  const frame = useRef<HTMLDivElement>(null);
  const capturedClick = useRef<{ button: HTMLButtonElement | null; trusted: boolean } | null>(null);

  const imageBlocks = useMemo<ImageBlock[]>(
    () =>
      Array.from({ length: imageCount }, (_, index) => ({
        type: 'image',
        attachmentId: `queued-image-${blockRevision}-${index + 1}`,
        mimeType: 'image/png',
        data: imageData[index % imageData.length],
      })),
    [imageCount, blockRevision],
  );
  const fileBlocks = useMemo<FileBlock[]>(
    () =>
      Array.from({ length: fileCount }, (_, index) => ({
        type: 'file',
        attachmentId: `queued-file-${blockRevision}-${index + 1}`,
        fileName: `${fileName}-${index + 1}.txt`,
        mimeType: 'text/plain',
        size: 1024 + index,
      })),
    [fileCount, fileName, blockRevision],
  );
  const message = useMemo<Message>(() => {
    const images = mode === 'images' || mode === 'mixed' ? imageBlocks : [];
    const files = mode === 'files' || mode === 'mixed' ? fileBlocks : [];
    return {
      imageBlocks: reversed ? [...images].reverse() : images,
      fileBlocks: reversed ? [...files].reverse() : files,
    };
  }, [mode, imageBlocks, fileBlocks, reversed]);

  // Replacing the resolver changes real caller sources without remounting the leaf.
  const queuedImageSrc = useMemo<QueuedMessageAttachmentsProps['queuedImageSrc']>(
    () => (block) =>
      nullSource
        ? null
        : `data:${block.mimeType};base64,${resolverRevision % 2 ? imageData[1] : block.data}`,
    [nullSource, resolverRevision],
  );

  function recordCallback(observation: CallbackObservation) {
    setObservations((current) => ({
      ...current,
      callbackCount: current.callbackCount + 1,
      callbacks: [...current.callbacks.slice(-11), observation],
    }));
  }

  // These are ordinary callback consumers; neither lightbox nor file services are called.
  const callbacks = useMemo(
    () => ({
      openImageLightbox: (block: ImageBlock, opener: HTMLButtonElement, index: number) => {
        const indexedButton = frame.current?.querySelectorAll(
          '[data-testid="queued-image-thumbnail"]',
        )[index];
        recordCallback({
          kind: 'image',
          callbackRevision,
          resolverRevision,
          mountRevision,
          block: { ...block },
          sameBlock: message.imageBlocks?.[index] === block,
          index,
          opener: {
            isButton: opener instanceof HTMLButtonElement,
            sameAsIndexedButton: opener === indexedButton,
            sameAsCapturedButton: opener === capturedClick.current?.button,
            contained: frame.current?.contains(opener) ?? false,
            connected: opener.isConnected,
            tagName: opener.tagName,
            testId: opener.dataset.testid ?? null,
            slot: opener.dataset.slot ?? null,
            capturedClickTrusted: capturedClick.current?.trusted ?? false,
          },
        });
      },
      openQueuedFileAttachment: (block: FileBlock) => {
        const index = message.fileBlocks?.indexOf(block) ?? -1;
        recordCallback({
          kind: 'file',
          callbackRevision,
          resolverRevision,
          mountRevision,
          block: { ...block },
          sameBlock: index >= 0,
          index,
        });
      },
      handleReferenceImageError: (block: ImageBlock, src: string) => {
        const index = message.imageBlocks?.indexOf(block) ?? -1;
        recordCallback({
          kind: 'image-error',
          callbackRevision,
          resolverRevision,
          mountRevision,
          block: { ...block },
          sameBlock: index >= 0,
          index,
          src,
        });
      },
    }),
    [message, callbackRevision, resolverRevision, mountRevision],
  );

  function observeParent(
    phase: ParentObservation['phase'],
    event: MouseEvent<HTMLDivElement> | PointerEvent<HTMLDivElement>,
  ) {
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest('button') ?? null;
    if (phase === 'click-capture') {
      capturedClick.current = {
        button: button instanceof HTMLButtonElement ? button : null,
        trusted: event.nativeEvent.isTrusted,
      };
    }
    const observation = {
      phase,
      targetTag: target?.tagName ?? null,
      buttonTestId: button?.dataset.testid ?? null,
      trusted: event.nativeEvent.isTrusted,
    };
    setObservations((current) => ({
      ...current,
      parentCount: current.parentCount + 1,
      parent: [...current.parent.slice(-11), observation],
    }));
  }

  return (
    <section
      className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4"
      data-testid="queued-attachments"
      data-functional-example="queued-attachments"
      aria-label="Queued attachments exercise"
    >
      <h2>Queued message attachments</h2>
      <p className="type-caption text-muted-foreground">
        Internal, unreleased callback exercise. Image and file activation only records the real
        arguments. PNG data decodes in the browser; files are never fetched.
      </p>
      <FormField
        label="Attachment content"
        control={(field) => (
          <ToggleGroup
            {...field}
            aria-label="Attachment content"
            type="single"
            value={mode}
            onValueChange={(value) => {
              const next = modes.find((item) => item === value);
              if (next) setMode(next);
            }}
          >
            {modes.map((value) => (
              <ToggleGroupItem key={value} value={value}>
                {value}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}
      />
      <div className="flex min-w-0 flex-wrap gap-3">
        {(
          [
            ['Image count', imageCount, setImageCount],
            ['File count', fileCount, setFileCount],
          ] as const
        ).map(([label, value, setValue]) => (
          <FormField
            key={label}
            label={label}
            control={(field) => (
              <Input
                {...field}
                type="number"
                min={0}
                max={8}
                step={1}
                value={value}
                onChange={(event) => {
                  const next = event.target.valueAsNumber;
                  if (Number.isInteger(next) && next >= 0 && next <= 8) setValue(next);
                }}
              />
            )}
          />
        ))}
      </div>
      <FormField
        label="File name prefix"
        control={(field) => (
          <Input
            {...field}
            value={fileName}
            maxLength={120}
            onChange={(event) => setFileName(event.target.value)}
          />
        )}
      />
      <div className="flex min-w-0 flex-wrap items-end gap-3">
        <BooleanField label="Reverse block order" value={reversed} onChange={setReversed} />
        <BooleanField
          label="Return null image sources"
          value={nullSource}
          onChange={setNullSource}
        />
        <BooleanField label="Mount queued attachments" value={mounted} onChange={setMounted} />
      </div>
      <div className="flex min-w-0 flex-wrap gap-3">
        <Button onClick={() => setBlockRevision((value) => value + 1)}>
          Replace block identities
        </Button>
        <Button onClick={() => setResolverRevision((value) => value + 1)}>
          Replace image resolver
        </Button>
        <Button onClick={() => setCallbackRevision((value) => value + 1)}>
          Replace attachment callbacks
        </Button>
        <Button disabled={!mounted} onClick={() => setMountRevision((value) => value + 1)}>
          Remount queued attachments
        </Button>
        <Button
          onClick={() => {
            capturedClick.current = null;
            setObservations({ parentCount: 0, callbackCount: 0, parent: [], callbacks: [] });
          }}
        >
          Clear attachment observations
        </Button>
      </div>
      <div
        ref={frame}
        role="presentation"
        className="min-h-8 w-full min-w-0 max-w-[420px]"
        data-testid="queued-attachments-frame"
        onClickCapture={(event) => observeParent('click-capture', event)}
        onClick={(event) => observeParent('click-bubble', event)}
        onPointerDownCapture={(event) => observeParent('pointer-capture', event)}
        onPointerDown={(event) => observeParent('pointer-bubble', event)}
      >
        {mounted && (
          <div key={mountRevision} data-testid="queued-attachments-leaf">
            <QueuedMessageAttachments
              message={message}
              queuedImageSrc={queuedImageSrc}
              {...callbacks}
            />
          </div>
        )}
      </div>
      <pre
        className="min-w-0 whitespace-pre-wrap wrap-anywhere"
        aria-label="Queued attachments caller state"
        data-testid="queued-attachments-state"
      >
        {JSON.stringify(
          {
            mode,
            imageCount,
            fileCount,
            fileName,
            blockRevision,
            reversed,
            nullSource,
            resolverRevision,
            callbackRevision,
            mounted,
            mountRevision,
            message,
            observations,
          },
          null,
          2,
        )}
      </pre>
    </section>
  );
}
