// i18n-ignore (internal, unreleased catalog controls and caller observations)
import { useCallback, useEffect, useRef, useState } from 'react';
import { FormField } from '@/components/patterns/form';
import { Button } from '@/components/ui/button';
import { FileInput } from '@/components/ui/file-input';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  ChatVideoBlock,
  type ChatVideoBlockProps,
} from '@/features/chat/components/chat-video-block';
import type { VideoSource } from '$shared/types/video-source';

type LocalMedia = { file: File; url: string; data: string; mimeType: string };
type LinkObservation = {
  sequence: number;
  callbackRevision: number;
  mountRevision: number;
  currentName: string | undefined;
  args: Parameters<ChatVideoBlockProps['onOpenLink']>;
};

function useLocalMedia(onRead: (media: LocalMedia) => void) {
  const reader = useRef<FileReader | null>(null);
  const [media, setMedia] = useState<LocalMedia | null>(null);
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
    setError('');
    setMedia(null);
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
      // Split only FileReader's data-URL envelope; retain its MIME and exact base64 bytes.
      const separator = next.result.indexOf(';base64,');
      const result = {
        file,
        url: next.result,
        mimeType: next.result.slice(5, separator),
        data: next.result.slice(separator + 8),
      };
      setMedia(result);
      onRead(result);
    };
    next.onerror = () => {
      if (reader.current !== next) return;
      reader.current = null;
      setReading(false);
      setError(next.error?.message ?? 'File could not be read.');
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

function ChoiceField<T extends string>({
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

function Observation({ label, value }: { label: string; value: unknown }) {
  return (
    <output
      aria-label={label}
      className="block max-h-64 min-w-0 max-w-full overflow-auto whitespace-pre-wrap wrap-anywhere"
    >
      {JSON.stringify(value, (_key, entry) => (entry === undefined ? '[undefined]' : entry), 2)}
    </output>
  );
}

export function ChatVideoExamples() {
  const [source, setSource] = useState<VideoSource | null>(null);
  const [kind, setKind] = useState<VideoSource['kind']>('inline');
  const [data, setData] = useState('');
  const [inlineMime, setInlineMime] = useState('video/webm');
  const [url, setUrl] = useState('');
  const [remoteMime, setRemoteMime] = useState('video/webm');
  const [supplyRemoteMime, setSupplyRemoteMime] = useState(false);
  const [workspaceMime, setWorkspaceMime] = useState<'video/mp4' | 'video/webm'>('video/webm');
  const [name, setName] = useState('Local video');
  const [supplyName, setSupplyName] = useState(false);
  const [poster, setPoster] = useState('');
  const [supplyPoster, setSupplyPoster] = useState(false);
  const [allowFileMedia, setAllowFileMedia] = useState(false);
  const [supplyAllowFileMedia, setSupplyAllowFileMedia] = useState(true);
  const [canOpenFile, setCanOpenFile] = useState(true);
  const [supplyCanOpenFile, setSupplyCanOpenFile] = useState(false);
  const [mounted, setMounted] = useState(true);
  const [mountRevision, setMountRevision] = useState(0);
  const [callbackRevision, setCallbackRevision] = useState(0);
  const [links, setLinks] = useState<LinkObservation[]>([]);
  const sequence = useRef(0);

  function applyLocalVideo(media: LocalMedia) {
    setKind('inline');
    setData(media.data);
    setInlineMime(media.mimeType);
    setUrl(media.url);
    setRemoteMime(media.mimeType);
    setName(media.file.name);
    setSupplyName(true);
    setSource({ kind: 'inline', data: media.data, mimeType: media.mimeType });
  }
  const videoFile = useLocalMedia(applyLocalVideo);
  const posterFile = useLocalMedia((media) => {
    setPoster(media.url);
    setSupplyPoster(true);
  });
  const onOpenLink = useCallback<ChatVideoBlockProps['onOpenLink']>(
    (...args) => {
      const observation = {
        sequence: ++sequence.current,
        callbackRevision,
        mountRevision,
        currentName: supplyName ? name : undefined,
        args,
      };
      setLinks((previous) => [...previous.slice(-11), observation]);
      return true;
    },
    [callbackRevision, mountRevision, name, supplyName],
  );

  const draft: VideoSource =
    kind === 'inline'
      ? { kind, data, mimeType: inlineMime }
      : kind === 'workspace'
        ? { kind, url, mimeType: workspaceMime }
        : { kind, url, ...(supplyRemoteMime ? { mimeType: remoteMime } : {}) };
  const optionalProps = {
    ...(supplyName ? { name } : {}),
    ...(supplyPoster ? { poster } : {}),
    ...(supplyAllowFileMedia ? { allowFileMedia } : {}),
    ...(supplyCanOpenFile ? { canOpenFile: () => canOpenFile } : {}),
  };

  return (
    <section
      data-functional-example="chat-video"
      aria-label="Chat video example"
      className="grid w-full min-w-0 max-w-[420px] gap-4"
    >
      <h2>Chat video</h2>
      <p>
        Internal, unreleased exercise. Choose a local video to pass real FileReader bytes to
        ChatVideoBlock. No remote media loads by default. Playback and failures come from the
        browser.
      </p>
      <div data-testid="chat-video-frame" className="min-w-0 max-w-full">
        {mounted && source && (
          <ChatVideoBlock
            key={mountRevision}
            source={source}
            {...optionalProps}
            onOpenLink={onOpenLink}
          />
        )}
      </div>
      {!source && <p>Choose a video or apply a source to begin.</p>}
      <FileInput
        id="catalog-chat-video-file"
        label="Choose local video"
        accept="video/*"
        onFilesChange={videoFile.read}
      />
      <Button
        variant="outline"
        disabled={!videoFile.media}
        onClick={() => {
          if (videoFile.media) applyLocalVideo(videoFile.media);
        }}
      >
        Use selected video
      </Button>
      <ChoiceField
        label="Source kind"
        value={kind}
        options={['inline', 'remote', 'workspace']}
        onChange={setKind}
      />
      {kind === 'inline' ? (
        <>
          <TextField label="Inline MIME type" value={inlineMime} onChange={setInlineMime} />
          <TextField label="Inline base64 data" value={data} onChange={setData} multiline />
        </>
      ) : (
        <>
          <TextField label="Source URL" value={url} onChange={setUrl} multiline />
          {kind === 'workspace' ? (
            <ChoiceField
              label="Workspace MIME type"
              value={workspaceMime}
              options={['video/mp4', 'video/webm']}
              onChange={setWorkspaceMime}
            />
          ) : (
            <>
              <BooleanField
                label="Supply remote MIME type"
                value={supplyRemoteMime}
                onChange={setSupplyRemoteMime}
              />
              <TextField label="Remote MIME type" value={remoteMime} onChange={setRemoteMime} />
            </>
          )}
        </>
      )}
      <Button onClick={() => setSource(draft)}>Apply source</Button>
      <p>
        Source fields apply together. Selecting a video applies it immediately and also retains its
        data URL for the remote or workspace shape. Source and prop changes keep the same component;
        a failed frame stays failed until an explicit remount.
      </p>
      <BooleanField label="Supply name" value={supplyName} onChange={setSupplyName} />
      <TextField label="Video name" value={name} onChange={setName} />
      <FileInput
        id="catalog-chat-video-poster"
        label="Choose local poster"
        accept="image/*"
        onFilesChange={posterFile.read}
      />
      <BooleanField label="Supply poster" value={supplyPoster} onChange={setSupplyPoster} />
      <TextField label="Poster URL" value={poster} onChange={setPoster} multiline />
      <BooleanField
        label="Supply allowFileMedia"
        value={supplyAllowFileMedia}
        onChange={setSupplyAllowFileMedia}
      />
      <BooleanField label="Allow file media" value={allowFileMedia} onChange={setAllowFileMedia} />
      <BooleanField
        label="Supply canOpenFile callback"
        value={supplyCanOpenFile}
        onChange={setSupplyCanOpenFile}
      />
      <BooleanField label="canOpenFile result" value={canOpenFile} onChange={setCanOpenFile} />
      <div className="flex min-w-0 flex-wrap gap-2">
        <Button variant="outline" onClick={() => setCallbackRevision((value) => value + 1)}>
          Replace callbacks
        </Button>
        <Button variant="outline" onClick={() => setMounted((value) => !value)}>
          {mounted ? 'Unmount video' : 'Mount video'}
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            setMountRevision((value) => value + 1);
            setMounted(true);
          }}
        >
          Remount video
        </Button>
        <Button variant="outline" onClick={() => setLinks([])}>
          Clear observations
        </Button>
      </div>
      <Observation
        label="Chat video caller state"
        value={{
          mounted,
          mountRevision,
          callbackRevision,
          source:
            source?.kind === 'inline'
              ? { kind: source.kind, mimeType: source.mimeType, base64Length: source.data.length }
              : source,
          name: supplyName ? name : undefined,
          poster: supplyPoster ? poster : undefined,
          allowFileMedia: supplyAllowFileMedia ? allowFileMedia : undefined,
          canOpenFile: supplyCanOpenFile ? canOpenFile : undefined,
        }}
      />
      <Observation
        label="Chat video file reads"
        value={Object.fromEntries(
          (
            [
              ['video', videoFile],
              ['poster', posterFile],
            ] as const
          ).map(([key, read]) => {
            return [
              key,
              {
                reading: read.reading,
                error: read.error,
                file: read.media
                  ? {
                      name: read.media.file.name,
                      size: read.media.file.size,
                      type: read.media.file.type,
                      mimeType: read.media.mimeType,
                      base64Length: read.media.data.length,
                    }
                  : null,
              },
            ];
          }),
        )}
      />
      <Observation label="Chat video link calls" value={links} />
      <p>
        The link callback retains the last 12 calls with their actual arguments and current caller
        name, then returns true without navigation. canOpenFile is an ordinary callback returning
        the selected boolean. These controls do not change workspace permissions. Caller
        observations do not assert decoding, loading, error, lightbox or resource-cleanup results.
      </p>
    </section>
  );
}
