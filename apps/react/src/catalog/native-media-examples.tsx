// i18n-ignore (internal native file and media exercises)
import { useEffect, useRef, useState } from 'react';
import { FormField } from '@/components/patterns/form';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Button } from '@/components/ui/button';
import { FileInput } from '@/components/ui/file-input';
import { ImageLightbox } from '@/components/ui/image-lightbox';
import { VideoLightbox } from '@/components/ui/video-lightbox';
import {
  AttachmentPreview,
  type AttachmentPreviewProps,
} from '@/features/chat/components/attachment-preview';

type LocalAttachment = {
  slot: string;
  id: string;
  name: string;
  type: string;
  file: File;
  variant: 'chip' | 'thumbnail';
  placementStatus: AttachmentPreviewProps['placementStatus'];
  progress: string;
  placementError: string;
  supplyFile: boolean;
  supplyData: boolean;
  supplyMime: boolean;
  data: { base64: string; mimeType: string; name: string; size: number } | null;
  classNameEnabled: boolean;
  className: string;
  sourceClass: string;
};

type AttachmentObservation = {
  sequence: number;
  slot: string;
  currentId: string;
  revision: number;
  kind: string;
  args?: string[];
  target?: string;
  label?: string | null;
  defaultPrevented?: boolean;
  eventPhase?: number;
};

function AttachmentTextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <FormField
      label={label}
      control={(field) => (
        <Input {...field} value={value} onChange={(event) => onChange(event.currentTarget.value)} />
      )}
    />
  );
}

function AttachmentSwitch({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <FormField
      label={label}
      control={(field) => (
        <Switch {...field} ariaLabel={label} checked={checked} onCheckedChange={onChange} />
      )}
    />
  );
}

export function NativeAttachmentExample() {
  const [attachments, setAttachments] = useState<LocalAttachment[]>([]);
  const [selectedSlot, setSelectedSlot] = useState('');
  const [removed, setRemoved] = useState<string[]>([]);
  const [callbacks, setCallbacks] = useState<AttachmentObservation[]>([]);
  const [capture, setCapture] = useState<AttachmentObservation[]>([]);
  const [bubble, setBubble] = useState<AttachmentObservation[]>([]);
  const [removeEnabled, setRemoveEnabled] = useState(true);
  const [retryEnabled, setRetryEnabled] = useState(false);
  const [callbackRevision, setCallbackRevision] = useState(0);
  const [mounted, setMounted] = useState(true);
  const [mountRevision, setMountRevision] = useState(0);
  const [showReplacement, setShowReplacement] = useState(false);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState('');
  const reader = useRef<FileReader | null>(null);
  const sequence = useRef(0);
  const eventSequence = useRef(0);
  const previewParent = useRef<HTMLDivElement>(null);
  const selected = attachments.find((item) => item.slot === selectedSlot) ?? attachments[0];
  const selectedIndex = selected ? attachments.indexOf(selected) : -1;

  useEffect(
    () => () => {
      const previous = reader.current;
      reader.current = null;
      previous?.abort();
    },
    [],
  );

  useEffect(() => {
    const parent = previewParent.current;
    if (!parent) return;
    const observe = (event: MouseEvent, kind: 'capture' | 'bubble') => {
      const target = event.target instanceof Element ? event.target : null;
      const slot = target?.closest<HTMLElement>('[data-attachment-slot]')?.dataset.attachmentSlot;
      const item = attachments.find((attachment) => attachment.slot === slot);
      if (!item) return;
      const entry: AttachmentObservation = {
        sequence: ++eventSequence.current,
        slot: item.slot,
        currentId: item.id,
        revision: callbackRevision,
        kind: `native-${kind}`,
        target: target?.tagName,
        label: target?.closest('[aria-label]')?.getAttribute('aria-label'),
        defaultPrevented: event.defaultPrevented,
        eventPhase: event.eventPhase,
      };
      (kind === 'capture' ? setCapture : setBubble)((current) => [...current, entry].slice(-12));
    };
    const onCapture = (event: MouseEvent) => observe(event, 'capture');
    const onBubble = (event: MouseEvent) => observe(event, 'bubble');
    parent.addEventListener('click', onCapture, true);
    parent.addEventListener('click', onBubble);
    return () => {
      parent.removeEventListener('click', onCapture, true);
      parent.removeEventListener('click', onBubble);
    };
  }, [attachments, callbackRevision]);

  function cancelRead() {
    const previous = reader.current;
    reader.current = null;
    previous?.abort();
    setReading(false);
    setReadError('');
  }

  function updateSelected(patch: Partial<LocalAttachment>) {
    if (!selected) return;
    setAttachments((current) =>
      current.map((item) => (item.slot === selected.slot ? { ...item, ...patch } : item)),
    );
  }

  function readSelectedFile() {
    cancelRead();
    if (!selected) return;
    const { file, slot } = selected;
    const next = new FileReader();
    reader.current = next;
    setReading(true);
    next.onload = () => {
      if (reader.current !== next) return;
      reader.current = null;
      setReading(false);
      const match =
        typeof next.result === 'string' && /^data:([^,]+);base64,(.*)$/s.exec(next.result);
      if (!match) {
        setReadError('The selected file did not produce a base64 data URL.');
        return;
      }
      const data = { mimeType: match[1], base64: match[2], name: file.name, size: file.size };
      setAttachments((current) =>
        current.map((item) =>
          item.slot === slot && item.file === file ? { ...item, data } : item,
        ),
      );
    };
    next.onerror = () => {
      if (reader.current !== next) return;
      reader.current = null;
      setReading(false);
      setReadError(next.error?.message ?? 'File could not be read.');
    };
    next.readAsDataURL(file);
  }

  function recordCallback(kind: string, item: LocalAttachment, id: string) {
    const entry = {
      sequence: ++eventSequence.current,
      slot: item.slot,
      currentId: item.id,
      revision: callbackRevision,
      kind,
      args: [id],
    };
    setCallbacks((current) => [...current, entry].slice(-12));
  }

  return (
    <section
      className="grid w-full min-w-0 max-w-[420px] grid-cols-[minmax(0,1fr)] gap-4 [overflow-wrap:anywhere]"
      data-functional-example="native-attachments"
      aria-label="Local attachment previews"
    >
      <h2>Local attachment previews</h2>
      <p>
        Choose real files to preview locally. Images open the production lightbox. Removing a
        preview does not delete the file. These controls are an internal component exercise.
      </p>
      <FileInput
        id="catalog-attachment-files"
        label="Choose local attachments"
        multiple
        onFilesChange={(files) => {
          const additions = Array.from(files ?? [], (file): LocalAttachment => {
            const id = `local-${++sequence.current}`;
            return {
              slot: id,
              id,
              file,
              name: file.name,
              type: file.type,
              variant: file.type.startsWith('image/') ? 'thumbnail' : 'chip',
              placementStatus: undefined,
              progress: '',
              placementError: '',
              supplyFile: true,
              supplyData: false,
              supplyMime: true,
              data: null,
              classNameEnabled: false,
              className: '',
              sourceClass: '',
            };
          });
          setAttachments((current) => [...current, ...additions]);
        }}
      />
      <div
        ref={previewParent}
        className="flex min-w-0 flex-wrap gap-3"
        aria-label="Attachment preview area"
      >
        {mounted &&
          attachments.map((item) => {
            const progress = item.progress.trim() === '' ? undefined : Number(item.progress);
            return (
              <div key={item.slot} data-attachment-slot={item.slot} className="min-w-0 max-w-full">
                <AttachmentPreview
                  key={mountRevision}
                  id={item.id}
                  name={item.name}
                  type={item.type}
                  size={item.file.size}
                  file={item.supplyFile ? item.file : undefined}
                  imageData={item.supplyData ? item.data?.base64 : undefined}
                  imageMimeType={item.supplyMime ? item.data?.mimeType : undefined}
                  variant={item.variant}
                  placementStatus={item.placementStatus}
                  placementProgress={
                    progress !== undefined && Number.isFinite(progress) ? progress : undefined
                  }
                  placementError={item.placementError || undefined}
                  className={item.classNameEnabled ? item.className : undefined}
                  class={item.sourceClass}
                  onRemove={
                    removeEnabled
                      ? (id) => {
                          recordCallback('remove', item, id);
                          cancelRead();
                          setAttachments((current) =>
                            current.filter((entry) => entry.slot !== item.slot || entry.id !== id),
                          );
                          setRemoved((current) => [...current, id].slice(-12));
                        }
                      : undefined
                  }
                  onRetry={retryEnabled ? (id) => recordCallback('retry', item, id) : undefined}
                />
              </div>
            );
          })}
      </div>
      <output className="min-w-0 whitespace-pre-wrap" aria-label="Local attachment files">
        {JSON.stringify(
          attachments.map(({ id, file }) => ({
            id,
            name: file.name,
            type: file.type,
            size: file.size,
          })),
        )}
      </output>
      <output className="min-w-0 whitespace-pre-wrap" aria-label="Removed attachment IDs">
        {JSON.stringify(removed)}
      </output>
      {selected && (
        <>
          <FormField
            label="Selected attachment slot"
            description="One-based position. Editing the callback ID keeps the same mounted slot."
            control={(field) => (
              <Input
                {...field}
                type="number"
                min={1}
                max={attachments.length}
                step={1}
                value={selectedIndex + 1}
                onChange={(event) => {
                  const item = attachments[event.currentTarget.valueAsNumber - 1];
                  if (item) {
                    cancelRead();
                    setSelectedSlot(item.slot);
                  }
                }}
              />
            )}
          />
          <AttachmentTextField
            label="Attachment ID"
            value={selected.id}
            onChange={(id) => updateSelected({ id })}
          />
          <AttachmentTextField
            label="Attachment name"
            value={selected.name}
            onChange={(name) => updateSelected({ name })}
          />
          <AttachmentTextField
            label="Attachment type"
            value={selected.type}
            onChange={(type) => updateSelected({ type })}
          />
          <FormField
            label="Attachment variant"
            control={(field) => (
              <ToggleGroup
                {...field}
                aria-label="Attachment variant"
                type="single"
                className="min-w-0 flex-wrap justify-start"
                value={selected.variant}
                onValueChange={(variant) => {
                  if (variant === 'chip' || variant === 'thumbnail') updateSelected({ variant });
                }}
              >
                <ToggleGroupItem value="chip">Chip</ToggleGroupItem>
                <ToggleGroupItem value="thumbnail">Thumbnail</ToggleGroupItem>
              </ToggleGroup>
            )}
          />
          <FormField
            label="Placement status"
            control={(field) => (
              <ToggleGroup
                {...field}
                aria-label="Placement status"
                type="single"
                className="min-w-0 flex-wrap justify-start"
                value={selected.placementStatus ?? 'omitted'}
                onValueChange={(value) => {
                  if (value === 'omitted') updateSelected({ placementStatus: undefined });
                  else if (value === 'placed' || value === 'placing' || value === 'failed')
                    updateSelected({ placementStatus: value });
                }}
              >
                <ToggleGroupItem value="omitted">Omitted</ToggleGroupItem>
                <ToggleGroupItem value="placed">Placed</ToggleGroupItem>
                <ToggleGroupItem value="placing">Placing</ToggleGroupItem>
                <ToggleGroupItem value="failed">Failed</ToggleGroupItem>
              </ToggleGroup>
            )}
          />
          <FormField
            label="Placement progress"
            description="Blank omits progress. Any finite fraction is passed unchanged; the component clamps it."
            error={
              selected.progress.trim() !== '' && !Number.isFinite(Number(selected.progress))
                ? 'Enter a finite number or leave blank.'
                : undefined
            }
            control={(field) => (
              <Input
                {...field}
                type="number"
                step="any"
                value={selected.progress}
                onChange={(event) => updateSelected({ progress: event.currentTarget.value })}
              />
            )}
          />
          <AttachmentTextField
            label="Placement failure detail"
            value={selected.placementError}
            onChange={(placementError) => updateSelected({ placementError })}
          />
          <AttachmentSwitch
            label="Show replacement picker"
            checked={showReplacement}
            onChange={setShowReplacement}
          />
          {showReplacement && (
            <FileInput
              key={selected.slot}
              id="catalog-attachment-replacement"
              label="Replace selected file"
              onFilesChange={(files) => {
                const file = files?.[0];
                if (!file) return;
                cancelRead();
                updateSelected({ file });
              }}
            />
          )}
          <p>
            Replacement keeps the slot, edited metadata and retained bytes. Edit name and type
            separately to exercise independent prop changes.
          </p>
          <div className="flex min-w-0 flex-wrap gap-2">
            <Button onClick={readSelectedFile}>Read selected file bytes</Button>
            <Button
              variant="outline"
              onClick={() => {
                cancelRead();
                updateSelected({ data: null });
              }}
            >
              Clear retained bytes
            </Button>
          </div>
          <AttachmentSwitch
            label="Supply selected File"
            checked={selected.supplyFile}
            onChange={(supplyFile) => updateSelected({ supplyFile })}
          />
          <AttachmentSwitch
            label="Supply retained imageData"
            checked={selected.supplyData}
            onChange={(supplyData) => updateSelected({ supplyData })}
          />
          <AttachmentSwitch
            label="Supply retained image MIME type"
            checked={selected.supplyMime}
            onChange={(supplyMime) => updateSelected({ supplyMime })}
          />
          <p>
            Read actual bytes, then supply both retained data and MIME type to exercise data
            precedence. Replace the File to compare two real sources. Omit data or MIME to return to
            the File; also omit File for the null-source branch. Retained bytes alone do not prove
            image decoding.
          </p>
          <AttachmentTextField
            label="Source class"
            value={selected.sourceClass}
            onChange={(sourceClass) => updateSelected({ sourceClass })}
          />
          <AttachmentSwitch
            label="Supply className override"
            checked={selected.classNameEnabled}
            onChange={(classNameEnabled) => updateSelected({ classNameEnabled })}
          />
          <AttachmentTextField
            label="ClassName override"
            value={selected.className}
            onChange={(className) => updateSelected({ className })}
          />
          <output className="min-w-0 whitespace-pre-wrap" aria-label="Selected attachment controls">
            {JSON.stringify({
              slot: selected.slot,
              id: selected.id,
              name: selected.name,
              type: selected.type,
              variant: selected.variant,
              placementStatus: selected.placementStatus ?? null,
              progress: selected.progress,
              placementError: selected.placementError,
              supplyFile: selected.supplyFile,
              supplyData: selected.supplyData,
              supplyMime: selected.supplyMime,
              retainedData: selected.data
                ? {
                    name: selected.data.name,
                    size: selected.data.size,
                    mimeType: selected.data.mimeType,
                    base64Length: selected.data.base64.length,
                  }
                : null,
              className: selected.classNameEnabled ? selected.className : null,
              sourceClass: selected.sourceClass,
            })}
          </output>
        </>
      )}
      <AttachmentSwitch
        label="Remove callback enabled"
        checked={removeEnabled}
        onChange={setRemoveEnabled}
      />
      <AttachmentSwitch
        label="Retry callback enabled"
        checked={retryEnabled}
        onChange={setRetryEnabled}
      />
      <div className="flex min-w-0 flex-wrap gap-2">
        <Button variant="outline" onClick={() => setCallbackRevision((value) => value + 1)}>
          Replace callbacks
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            cancelRead();
            setMounted((value) => !value);
          }}
        >
          {mounted ? 'Unmount previews' : 'Mount previews'}
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            cancelRead();
            setMountRevision((value) => value + 1);
            setMounted(true);
          }}
        >
          Remount previews
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            setCallbacks([]);
            setCapture([]);
            setBubble([]);
            setRemoved([]);
          }}
        >
          Clear observations
        </Button>
      </div>
      <output className="min-w-0 whitespace-pre-wrap" aria-label="Attachment lifecycle">
        {JSON.stringify({
          mounted,
          mountRevision,
          callbackRevision,
          removeEnabled,
          retryEnabled,
          reading,
          readError,
        })}
      </output>
      <output className="min-w-0 whitespace-pre-wrap" aria-label="Attachment callback log">
        {JSON.stringify(callbacks)}
      </output>
      <output className="min-w-0 whitespace-pre-wrap" aria-label="Attachment native capture log">
        {JSON.stringify(capture)}
      </output>
      <output className="min-w-0 whitespace-pre-wrap" aria-label="Attachment native bubble log">
        {JSON.stringify(bubble)}
      </output>
      <p>
        Logs retain the last 12 observations per stream. Callbacks report received arguments and
        current caller values; retry only records the callback. Native parent click capture and
        bubble are separate observations, not a prediction of React propagation. The source stops
        thumbnail removal and retry clicks, but lets chip removal bubble. Decode failures, browser
        errors and object URL revocation need independent native verification; this page does not
        count allocations or infer success from props. Placement controls do not upload files.
      </p>
    </section>
  );
}

export function NativeLightboxExample({ kind }: { kind: 'image' | 'video' }) {
  const reader = useRef<FileReader | null>(null);
  const [media, setMedia] = useState<{ file: File; url: string } | null>(null);
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);
  const [open, setOpen] = useState(false);
  const [opener, setOpener] = useState<HTMLElement | null>(null);
  const [closed, setClosed] = useState(0);
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
    setOpen(false);
    setMedia(null);
    setError('');
    const file = files?.[0];
    setReading(Boolean(file));
    if (!file) return;
    const next = new FileReader();
    reader.current = next;
    next.onload = () => {
      if (reader.current !== next) return;
      setReading(false);
      if (typeof next.result === 'string') setMedia({ file, url: next.result });
    };
    next.onerror = () => {
      if (reader.current !== next) return;
      setReading(false);
      setError(next.error?.message ?? 'File could not be read.');
    };
    next.readAsDataURL(file);
  }

  return (
    <section
      className="grid gap-4"
      data-functional-example={`native-${kind}-lightbox`}
      aria-label={`Native ${kind} lightbox example`}
    >
      <h2>Native {kind} lightbox</h2>
      <p>
        Choose a local {kind}. FileReader supplies its actual bytes to the lightbox and actions
        menu; metadata, downloads and clipboard use browser APIs. Workspace media still requires
        Electron integration.
      </p>
      <FileInput
        id={`catalog-${kind}-file`}
        label={`Choose local ${kind}`}
        accept={`${kind}/*`}
        onFilesChange={readFile}
      />
      <Button ref={setOpener} disabled={!media || reading} onClick={() => setOpen(true)}>
        Open {kind} lightbox
      </Button>
      {media &&
        (kind === 'image' ? (
          <ImageLightbox
            open={open}
            onOpenChange={setOpen}
            imageUrl={media.url}
            imageName={media.file.name}
            openerElement={opener}
            showActionsMenu
            onClose={() => setClosed((count) => count + 1)}
          />
        ) : (
          <VideoLightbox
            open={open}
            onOpenChange={setOpen}
            videoUrl={media.url}
            videoName={media.file.name}
            mimeType={media.file.type}
            sourceKind="inline"
            openerElement={opener}
            onClose={() => setClosed((count) => count + 1)}
          />
        ))}
      <output aria-label={`${kind} file metadata`}>
        {JSON.stringify(
          media ? { name: media.file.name, size: media.file.size, type: media.file.type } : null,
        )}
      </output>
      <output aria-label={`${kind} reading`}>{String(reading)}</output>
      <output aria-label={`${kind} read error`}>{error}</output>
      <output aria-label={`${kind} lightbox open`}>{String(open)}</output>
      <output aria-label={`${kind} lightbox close count`}>{closed}</output>
    </section>
  );
}
