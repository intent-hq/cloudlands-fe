// i18n-ignore (internal, unreleased catalog controls and caller observations)
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FormField } from '@/components/patterns/form';
import { Button } from '@/components/ui/button';
import { FileInput } from '@/components/ui/file-input';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  ChatImageBlock,
  type ChatImageBlockProps,
} from '@/features/chat/components/chat-image-block';

type Flag = 'omit' | 'true' | 'false';
type Observation = Record<string, unknown>;
type LocalImage = {
  file: File;
  files: FileList;
  fileId: number;
  fileListId: number;
  url: string;
  data: string;
  mimeType: string;
};
const flagNames = ['dataTruncated', 'dataIsThumbnail', 'hydrationLoading'] as const;
const longAlt =
  'A locally selected image with a long descriptive filename for inspecting the file caption and its overflow tooltip.png';

function useLocalImage(objectId: (object: object) => number) {
  const reader = useRef<FileReader | null>(null);
  const [media, setMedia] = useState<LocalImage | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  useEffect(
    () => () => {
      const previous = reader.current;
      reader.current = null;
      previous?.abort();
    },
    [],
  );

  function read(files: FileList | undefined) {
    const previous = reader.current;
    reader.current = null;
    previous?.abort();
    setMedia(null);
    setError('');
    setReading(false);
    const file = files?.item(0);
    if (!files || !file) return;
    if (file.type !== 'image/png' && file.type !== 'image/jpeg') {
      setError('Choose a local PNG or JPEG image.');
      return;
    }
    const next = new FileReader();
    reader.current = next;
    setReading(true);
    next.onload = () => {
      if (reader.current !== next) return;
      reader.current = null;
      setReading(false);
      if (typeof next.result !== 'string') return;
      const separator = next.result.indexOf(';base64,');
      if (separator < 0) {
        setError('The file reader did not return base64 image data.');
        return;
      }
      setMedia({
        file,
        files,
        fileId: objectId(file),
        fileListId: objectId(files),
        url: next.result,
        mimeType: next.result.slice(5, separator),
        data: next.result.slice(separator + 8),
      });
    };
    next.onerror = () => {
      if (reader.current !== next) return;
      reader.current = null;
      setReading(false);
      setError(next.error?.message ?? 'The local image could not be read.');
    };
    next.readAsDataURL(file);
  }
  return { media, reading, error, read };
}

function TextField({
  label,
  value,
  onChange,
  multiline = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
}) {
  return (
    <FormField
      label={label}
      control={(field) =>
        multiline ? (
          <Textarea
            {...field}
            rows={3}
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
            const choice = options.find((option) => option === next);
            if (choice) onChange(choice);
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
      className="block min-w-0 max-w-full whitespace-pre-wrap wrap-anywhere"
    >
      {JSON.stringify(
        value,
        (_key, entry) =>
          entry === undefined
            ? '[undefined]'
            : typeof entry === 'number' && !Number.isFinite(entry)
              ? String(entry)
              : entry,
        2,
      )}
    </output>
  );
}

function describeTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return null;
  return {
    tag: target.tagName,
    id: target.id,
    testId: target.getAttribute('data-testid'),
    ariaLabel: target.getAttribute('aria-label'),
  };
}

function useObservations() {
  const identities = useRef({ next: 0, objects: new WeakMap<object, number>() });
  const records = useRef({ callbacks: [] as Observation[], native: [] as Observation[] });
  const retainedEvents = useRef<Event[]>([]);
  const capturedEvent = useRef<Event | null>(null);
  const [snapshot, setSnapshot] = useState({
    revision: 0,
    callbacks: [] as Observation[],
    native: [] as Observation[],
  });
  const objectId = useCallback((object: object) => {
    const registry = identities.current;
    let id = registry.objects.get(object);
    if (id === undefined) {
      id = ++registry.next;
      registry.objects.set(object, id);
    }
    return id;
  }, []);
  const eventSnapshot = useCallback(
    (event: Event) => ({
      objectId: objectId(event),
      type: event.type,
      isTrusted: event.isTrusted,
      target: describeTarget(event.target),
      currentTarget: describeTarget(event.currentTarget),
      eventPhase: event.eventPhase,
      defaultPrevented: event.defaultPrevented,
      cancelBubble: event.cancelBubble,
      ...(event instanceof MouseEvent ? { button: event.button, detail: event.detail } : {}),
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
      ...(event.target instanceof HTMLImageElement
        ? {
            image: {
              complete: event.target.complete,
              naturalWidth: event.target.naturalWidth,
              naturalHeight: event.target.naturalHeight,
              sourceLength: event.target.currentSrc.length,
            },
          }
        : {}),
    }),
    [objectId],
  );
  const frameRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node) return;
      const cleanup = [
        'click',
        'contextmenu',
        'keydown',
        'keyup',
        'copy',
        'focusin',
        'load',
        'error',
      ].flatMap((type) =>
        [true, false].map((capture) => {
          const listener = (event: Event) => {
            if (capture) {
              capturedEvent.current = event;
              retainedEvents.current = [...retainedEvents.current.slice(-11), event];
            }
            records.current.native = [
              ...records.current.native.slice(-23),
              { phase: capture ? 'capture' : 'bubble', ...eventSnapshot(event) },
            ];
          };
          node.addEventListener(type, listener, { capture, passive: true });
          return () => node.removeEventListener(type, listener, capture);
        }),
      );
      return () => {
        cleanup.forEach((release) => release());
        capturedEvent.current = null;
      };
    },
    [eventSnapshot],
  );
  const record = useCallback(
    (observation: Observation) => {
      const event = capturedEvent.current;
      records.current.callbacks = [
        ...records.current.callbacks.slice(-11),
        {
          ...observation,
          capturedEvent: event && event.eventPhase !== Event.NONE ? eventSnapshot(event) : null,
        },
      ];
    },
    [eventSnapshot],
  );
  return {
    objectId,
    frameRef,
    record,
    snapshot,
    refresh: () =>
      setSnapshot((current) => ({
        revision: current.revision + 1,
        callbacks: records.current.callbacks,
        native: [
          ...records.current.native,
          ...retainedEvents.current.map((event) => ({ phase: 'settled', ...eventSnapshot(event) })),
        ],
      })),
    clear: () => {
      records.current = { callbacks: [], native: [] };
      retainedEvents.current = [];
      capturedEvent.current = null;
      setSnapshot((current) => ({ revision: current.revision + 1, ...records.current }));
    },
  };
}

function usePasteObservations(objectId: (object: object) => number) {
  const reader = useRef<FileReader | null>(null);
  const sequence = useRef(0);
  const [observations, setObservations] = useState<Observation[]>([]);
  useEffect(
    () => () => {
      const previous = reader.current;
      reader.current = null;
      previous?.abort();
    },
    [],
  );

  function paste(event: ClipboardEvent) {
    reader.current?.abort();
    reader.current = null;
    const clipboard = event.clipboardData;
    const file = clipboard?.files.item(0);
    const id = ++sequence.current;
    setObservations((current) => [
      ...current.slice(-3),
      {
        sequence: id,
        eventId: objectId(event),
        isTrusted: event.isTrusted,
        types: Array.from(clipboard?.types ?? []),
        fileCount: clipboard?.files.length ?? 0,
        file: file
          ? { objectId: objectId(file), name: file.name, type: file.type, size: file.size }
          : null,
        mimeType: file?.type ?? null,
        dataUrl: null,
        readError: null,
        reading: Boolean(file),
      },
    ]);
    if (!file) return;
    const next = new FileReader();
    reader.current = next;
    const finish = (dataUrl: string | null, readError: string | null) => {
      if (reader.current !== next) return;
      reader.current = null;
      setObservations((current) =>
        current.map((entry) =>
          entry.sequence === id ? { ...entry, dataUrl, readError, reading: false } : entry,
        ),
      );
    };
    next.onload = () => finish(typeof next.result === 'string' ? next.result : null, null);
    next.onerror = () => finish(null, next.error?.message ?? 'FileReader error');
    next.onabort = () => finish(null, 'FileReader aborted');
    next.readAsDataURL(file);
  }
  return { observations, paste };
}

export function ChatImageExamples() {
  const { objectId, frameRef, record, snapshot, refresh, clear } = useObservations();
  const sourceFile = useLocalImage(objectId);
  const fullFile = useLocalImage(objectId);
  const pasted = usePasteObservations(objectId);
  const [src, setSrc] = useState('');
  const [data, setData] = useState('');
  const [supplySrc, setSupplySrc] = useState(false);
  const [supplyData, setSupplyData] = useState(false);
  const [mimeType, setMimeType] = useState('image/png');
  const [variant, setVariant] = useState<'omit' | 'default' | 'file'>('omit');
  const [altMode, setAltMode] = useState<'omit' | 'current' | 'empty' | 'long'>('omit');
  const [alt, setAlt] = useState('Local image');
  const [widthMode, setWidthMode] = useState<'omit' | 'value'>('omit');
  const [heightMode, setHeightMode] = useState<'omit' | 'value'>('omit');
  const [width, setWidth] = useState('640');
  const [height, setHeight] = useState('360');
  const [flags, setFlags] = useState<Record<(typeof flagNames)[number], Flag>>({
    dataTruncated: 'omit',
    dataIsThumbnail: 'omit',
    hydrationLoading: 'omit',
  });
  const [supplyHydrate, setSupplyHydrate] = useState(true);
  const [callbackRevision, setCallbackRevision] = useState(0);
  const [mountRevision, setMountRevision] = useState(0);
  const [mounted, setMounted] = useState(true);
  const [previewWidth, setPreviewWidth] = useState<'420' | '720' | 'full'>('420');
  const sequence = useRef(0);
  const props = useMemo(
    () => ({
      mimeType,
      ...(supplySrc ? { src } : {}),
      ...(supplyData ? { data } : {}),
      ...(variant !== 'omit' ? { variant } : {}),
      ...(altMode !== 'omit'
        ? { alt: altMode === 'empty' ? '' : altMode === 'long' ? longAlt : alt }
        : {}),
      ...(widthMode === 'value' ? { width: Number(width) } : {}),
      ...(heightMode === 'value' ? { height: Number(height) } : {}),
      ...Object.fromEntries(
        flagNames
          .filter((name) => flags[name] !== 'omit')
          .map((name) => [name, flags[name] === 'true']),
      ),
    }),
    [
      mimeType,
      supplySrc,
      src,
      supplyData,
      data,
      variant,
      altMode,
      alt,
      widthMode,
      width,
      heightMode,
      height,
      flags,
    ],
  );
  const currentInputs = useMemo(
    () => ({
      ...props,
      ...(supplySrc ? { src: { length: src.length, empty: src === '' } } : {}),
      ...(supplyData ? { data: { base64Length: data.length, empty: data === '' } } : {}),
    }),
    [props, supplySrc, src, supplyData, data],
  );
  const onHydrate = useCallback<NonNullable<ChatImageBlockProps['onHydrate']>>(
    (...args) => {
      record({
        sequence: ++sequence.current,
        name: 'onHydrate',
        callbackRevision,
        mountRevision,
        argumentCount: args.length,
        args,
        currentInputs,
      });
    },
    [record, callbackRevision, mountRevision, currentInputs],
  );
  const onOpenLink = useCallback<ChatImageBlockProps['onOpenLink']>(
    (...args) => {
      record({
        sequence: ++sequence.current,
        name: 'onOpenLink',
        callbackRevision,
        mountRevision,
        argumentCount: args.length,
        args,
        currentInputs,
        result: true,
      });
      return true;
    },
    [record, callbackRevision, mountRevision, currentInputs],
  );

  function applyData(media: LocalImage, full: boolean) {
    setData(media.data);
    setMimeType(media.mimeType);
    setSupplyData(true);
    if (full) {
      setSupplySrc(false);
      setFlags({ dataTruncated: 'false', dataIsThumbnail: 'false', hydrationLoading: 'false' });
    }
  }

  function fileObservation(read: ReturnType<typeof useLocalImage>) {
    const media = read.media;
    return {
      reading: read.reading,
      error: read.error,
      file: media
        ? {
            objectId: media.fileId,
            fileListId: media.fileListId,
            sameAsSelectedFile: media.files.item(0) === media.file,
            name: media.file.name,
            type: media.file.type,
            size: media.file.size,
            lastModified: media.file.lastModified,
            mimeType: media.mimeType,
            base64Length: media.data.length,
            dataUrlLength: media.url.length,
            currentSrcMatches: supplySrc && src === media.url,
            currentDataMatches: supplyData && data === media.data,
          }
        : null,
    };
  }

  return (
    <section
      data-functional-example="chat-image"
      aria-label="Chat image example"
      className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)] gap-4"
    >
      <h2>Chat image</h2>
      <p>
        Internal, unreleased exercise. Select local PNG or JPEG files, then apply their real bytes.
        Image decoding, lightbox and menus belong to ChatImageBlock. No image loads by default.
      </p>
      <Choice
        label="Preview width"
        value={previewWidth}
        options={['420', '720', 'full']}
        onChange={setPreviewWidth}
      />
      <div
        ref={frameRef}
        data-testid="chat-image-frame"
        className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)]"
        style={{ maxWidth: previewWidth === 'full' ? '100%' : `${previewWidth}px` }}
      >
        {mounted && (
          <ChatImageBlock
            key={mountRevision}
            {...props}
            {...(supplyHydrate ? { onHydrate } : {})}
            onOpenLink={onOpenLink}
          />
        )}
      </div>
      <FileInput
        id="catalog-chat-image-source"
        label="Choose source image"
        accept="image/png,image/jpeg"
        error={sourceFile.error}
        onFilesChange={sourceFile.read}
      />
      <Button
        variant="outline"
        disabled={!sourceFile.media}
        onClick={() => {
          if (!sourceFile.media) return;
          setSrc(sourceFile.media.url);
          setMimeType(sourceFile.media.mimeType);
          setSupplySrc(true);
        }}
      >
        Apply selected src
      </Button>
      <FileInput
        id="catalog-chat-image-full"
        label="Choose full image"
        accept="image/png,image/jpeg"
        error={fullFile.error}
        onFilesChange={fullFile.read}
      />
      <div className="flex min-w-0 flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={!fullFile.media}
          onClick={() => {
            if (fullFile.media) applyData(fullFile.media, false);
          }}
        >
          Apply selected data
        </Button>
        <Button
          variant="outline"
          disabled={!fullFile.media}
          onClick={() => {
            if (fullFile.media) applyData(fullFile.media, true);
          }}
        >
          Apply selected full image
        </Button>
      </div>
      <p>
        File selection stages bytes only. Apply selected src and Apply selected data keep both props
        independently available to exercise source precedence. Apply selected full image omits src,
        supplies the full image data and MIME type, and sets all three flags to false. It keeps the
        same component mounted.
      </p>
      <Toggle label="Supply src" value={supplySrc} onChange={setSupplySrc} />
      <TextField label="Source URL" value={src} onChange={setSrc} multiline />
      <Toggle label="Supply data" value={supplyData} onChange={setSupplyData} />
      <TextField label="Base64 data" value={data} onChange={setData} multiline />
      <TextField label="MIME type" value={mimeType} onChange={setMimeType} />
      <Choice
        label="Variant"
        value={variant}
        options={['omit', 'default', 'file']}
        onChange={setVariant}
      />
      <Choice
        label="Alt mode"
        value={altMode}
        options={['omit', 'current', 'empty', 'long']}
        onChange={setAltMode}
      />
      <TextField label="Current alt" value={alt} onChange={setAlt} />
      <Choice
        label="Width mode"
        value={widthMode}
        options={['omit', 'value']}
        onChange={setWidthMode}
      />
      <TextField label="Width value" value={width} onChange={setWidth} />
      <Choice
        label="Height mode"
        value={heightMode}
        options={['omit', 'value']}
        onChange={setHeightMode}
      />
      <TextField label="Height value" value={height} onChange={setHeight} />
      <p>
        Value mode passes Number of the raw text without rounding or clamping, including zero and
        fractional values. Omit mode leaves the prop out. Empty text becomes zero.
      </p>
      {flagNames.map((name) => (
        <Choice
          key={name}
          label={name}
          value={flags[name]}
          options={['omit', 'true', 'false']}
          onChange={(value) => setFlags((current) => ({ ...current, [name]: value }))}
        />
      ))}
      <Toggle label="Supply onHydrate" value={supplyHydrate} onChange={setSupplyHydrate} />
      <p>
        onHydrate records a callback only. Loading and replacement bytes change only through these
        controls; there is no hydration service. The required onOpenLink callback records arguments
        and returns true without navigation.
      </p>
      <div className="flex min-w-0 flex-wrap gap-2">
        <Button variant="outline" onClick={() => setCallbackRevision((value) => value + 1)}>
          Replace callbacks
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            if (!mounted) setMountRevision((value) => value + 1);
            setMounted((value) => !value);
          }}
        >
          {mounted ? 'Unmount image' : 'Mount image'}
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            setMountRevision((value) => value + 1);
            setMounted(true);
          }}
        >
          Remount image
        </Button>
        <Button variant="outline" onClick={refresh}>
          Refresh observations
        </Button>
        <Button variant="outline" onClick={clear}>
          Clear observations
        </Button>
      </div>
      <Output
        label="Chat image caller state"
        value={{
          mounted,
          mountRevision,
          callbackRevision,
          suppliedProps: Object.keys(props),
          inputs: currentInputs,
          onHydrate: supplyHydrate ? '[function]' : undefined,
          onOpenLink: '[function]',
        }}
      />
      <Output
        label="Chat image file reads"
        value={{ source: fileObservation(sourceFile), full: fileObservation(fullFile) }}
      />
      <Output label="Chat image observations" value={snapshot} />
      <FormField
        label="Paste copied image"
        control={(field) => (
          <Textarea {...field} rows={2} onPaste={(event) => pasted.paste(event.nativeEvent)} />
        )}
      />
      <Output label="Chat image paste observations" value={pasted.observations} />
      <p>
        Paste records the first File from each native paste and reads its exact data URL. The last
        four paste receipts update when FileReader finishes. The field does not read or change the
        clipboard outside that paste event.
      </p>
      <p>
        Refresh observations reads the last 12 callback calls, 24 native capture/bubble samples and
        12 retained native events after dispatch. Listeners do not change events. Exact current
        bytes remain in the source and data editors; file identities and byte comparisons refer to
        the selected File objects. These observations do not assert visual, hydration-service or
        download results.
      </p>
    </section>
  );
}
