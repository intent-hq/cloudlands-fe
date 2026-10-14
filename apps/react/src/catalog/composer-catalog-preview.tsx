// Source: MessageComposerCatalogPreview.svelte.
// i18n-ignore (reference catalog fixture content)
import { useState } from 'react';
import { AtIcon, PaperclipIcon, SparkleIcon } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import {
  MessageComposer,
  type MessageComposerSlotContext,
  type QueuedMessage,
} from '@/components/ui/message-composer';
import type { UiComponentFixture } from '$lib/components/ui/component-metadata';

function AttachSlot({ openFilePicker, files }: MessageComposerSlotContext) {
  return (
    <>
      <Button
        variant="ghost-light"
        size="icon-sm"
        iconOnly
        aria-label="Attach files"
        onClick={() => openFilePicker()}
      >
        <PaperclipIcon aria-hidden="true" />
      </Button>
      {files.length > 0 && (
        <span className="text-xs text-muted-foreground">{files.length} attached</span>
      )}
    </>
  );
}
function LeftSlot() {
  return (
    <Button variant="ghost-light" size="icon-sm" iconOnly aria-label="Add mention">
      <AtIcon aria-hidden="true" />
    </Button>
  );
}
function RightSlot() {
  return (
    <Button variant="ghost-light" size="icon-sm" iconOnly aria-label="Enhance prompt">
      <SparkleIcon aria-hidden="true" />
    </Button>
  );
}

export function ComposerCatalogPreview({ fixture }: { fixture: UiComponentFixture }) {
  const [sampleFiles] = useState(() =>
    typeof File === 'undefined'
      ? []
      : [
          new File(['preview'], 'workspace-map.png', { type: 'image/png' }),
          new File(['notes'], 'brief.pdf', { type: 'application/pdf' }),
        ],
  );
  const [value, setValue] = useState(fixture.id === 'basic' ? 'Try recalling message history' : '');
  const [files, setFiles] = useState<File[]>(fixture.id === 'attachments' ? sampleFiles : []);
  const [queue, setQueue] = useState<QueuedMessage[]>(
    fixture.id === 'queued-messages'
      ? [
          { id: 'catalog-1', text: 'Summarize the implementation plan', files: [] },
          { id: 'catalog-2', text: 'Then identify the main risks', files: sampleFiles.slice(0, 1) },
        ]
      : [],
  );
  const [status, setStatus] = useState<'idle' | 'streaming'>(
    fixture.id === 'queued-messages' ? 'streaming' : 'idle',
  );
  const [sendStatus, setSendStatus] = useState('No message sent yet');
  const [sends, setSends] = useState<Array<{ text: string; files: string[] }>>([]);
  const [queueChanges, setQueueChanges] = useState<string[][]>([]);
  return (
    <div
      className="grid w-full min-w-0 max-w-2xl gap-3"
      data-catalog-renderer-fixture={fixture.id}
      data-queue-changes={
        fixture.id === 'queued-messages' ? JSON.stringify(queueChanges) : undefined
      }
      data-catalog-rendered-state={fixture.states.join(' ')}
    >
      <MessageComposer
        value={value}
        files={files}
        queue={queue}
        status={status}
        maxFiles={fixture.id === 'max-files' ? 2 : undefined}
        history={
          fixture.id === 'basic' ? ['Review the architecture', 'Summarize the open tasks'] : []
        }
        suggestions={
          fixture.id === 'suggestions'
            ? [
                'Explain the latest changes',
                'Draft a concise release note',
                'List the remaining risks',
              ]
            : []
        }
        placeholderSuggestion={
          fixture.id === 'suggestions' ? 'Summarize the current workspace' : undefined
        }
        disabled={fixture.id === 'disabled'}
        leftSlot={
          fixture.id === 'attachments' || fixture.id === 'max-files'
            ? AttachSlot
            : fixture.id === 'left-slot-only'
              ? LeftSlot
              : undefined
        }
        rightSlot={fixture.id === 'right-slot-only' ? RightSlot : undefined}
        placeholder={fixture.id === 'disabled' ? 'Composer unavailable' : 'Ask me anything…'}
        onValueChange={setValue}
        onFilesChange={setFiles}
        onQueueChange={(next) => {
          if (fixture.id === 'queued-messages') {
            setQueueChanges((previous) => [...previous, next.map((item) => item.id)]);
          }
          setQueue(next);
        }}
        onStop={() => {
          setStatus('idle');
          setSendStatus('Stopped response');
        }}
        onSend={(text, sentFiles) => {
          if (fixture.id === 'max-files') {
            setSends((previous) => [
              ...previous,
              { text, files: sentFiles.map((file) => file.name) },
            ]);
          }
          setSendStatus(`Sent: ${text}`);
          setValue('');
          setStatus('streaming');
        }}
      />
      {fixture.id === 'playground' && (
        <div className="flex flex-wrap gap-2">
          <Button size="xs" onClick={() => setStatus(status === 'idle' ? 'streaming' : 'idle')}>
            Toggle streaming
          </Button>
          <Button size="xs" variant="outline" onClick={() => setValue('Queue this follow-up')}>
            Add draft
          </Button>
        </div>
      )}
      {['send-handler', 'playground'].includes(fixture.id) && (
        <output className="text-xs text-muted-foreground" aria-live="polite">
          {sendStatus}
        </output>
      )}
      {fixture.id === 'max-files' && (
        <output data-composer-sends className="text-xs break-all text-muted-foreground">
          {JSON.stringify(sends)}
        </output>
      )}
    </div>
  );
}
