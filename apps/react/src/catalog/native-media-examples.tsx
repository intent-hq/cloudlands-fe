// i18n-ignore (internal native file and media exercises)
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { FileInput } from '@/components/ui/file-input';
import { ImageLightbox } from '@/components/ui/image-lightbox';
import { VideoLightbox } from '@/components/ui/video-lightbox';
import { AttachmentPreview } from '@/features/chat/components/attachment-preview';

export function NativeAttachmentExample() {
  const [attachments, setAttachments] = useState<{ id: string; file: File }[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const sequence = useRef(0);
  return (
    <section
      className="grid gap-4"
      data-functional-example="native-attachments"
      aria-label="Local attachment previews"
    >
      <h2>Local attachment previews</h2>
      <p>
        Choose real files to preview locally. Images open the production lightbox. Removing a
        preview does not delete the file.
      </p>
      <FileInput
        id="catalog-attachment-files"
        label="Choose local attachments"
        multiple
        onFilesChange={(files) => {
          const additions = Array.from(files ?? [], (file) => ({
            id: `local-${++sequence.current}`,
            file,
          }));
          setAttachments((current) => [...current, ...additions]);
        }}
      />
      <div className="flex flex-wrap gap-3">
        {attachments.map(({ id, file }) => (
          <AttachmentPreview
            key={id}
            id={id}
            name={file.name}
            type={file.type}
            size={file.size}
            file={file}
            variant={file.type.startsWith('image/') ? 'thumbnail' : 'chip'}
            onRemove={(removedId) => {
              setAttachments((current) => current.filter((item) => item.id !== removedId));
              setRemoved((current) => [...current, removedId]);
            }}
          />
        ))}
      </div>
      <output aria-label="Local attachment files">
        {JSON.stringify(
          attachments.map(({ id, file }) => ({
            id,
            name: file.name,
            type: file.type,
            size: file.size,
          })),
        )}
      </output>
      <output aria-label="Removed attachment IDs">{JSON.stringify(removed)}</output>
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
