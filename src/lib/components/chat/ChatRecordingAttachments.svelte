<script lang="ts">
  import { untrack } from 'svelte';
  import { ContentDialog } from '$lib/components/patterns/confirm';
  import { m } from '$shared/paraglide/messages.js';
  import DockComposerAttachments from '$features/hud/components/DockComposerAttachments.svelte';
  import DockRecordingEditor from '$features/hud/media-editor/recording/DockRecordingEditor.svelte';
  import { createDockComposerLabels } from '$features/hud/composer/dock-composer-labels';
  import {
    dockClipPlaybackUrl,
    dockClipSendSummary,
  } from '$features/hud/composer/dock-composer-presentation';
  import { formatDockElapsed } from '$features/hud/composer/dock-annotation-bar-media';
  import type { DockComposerAttachment } from '$features/hud/components/dock-composer-media-presentation';
  import type { ChatDraftCapture, ChatDraftManager } from './chat-panel-draft.svelte';
  import { chatRecordingEvidence } from './chat-recording-attachments';
  import { createChatRecordingEditor } from './chat-recording-editor.svelte';
  let {
    capture,
    drafts,
    disabled = false,
    onRemove,
    controllerFactory = createChatRecordingEditor,
  }: {
    capture: ChatDraftCapture | null;
    drafts: ChatDraftManager;
    disabled?: boolean;
    onRemove: (id: string) => boolean;
    controllerFactory?: typeof createChatRecordingEditor;
  } = $props();
  const controller = untrack(() =>
    controllerFactory({
      drafts,
      capture: () => capture,
      disabled: () => disabled,
      onRemove: (id) => onRemove(id),
    }),
  );
  const labels = $derived(createDockComposerLabels());
  const evidence = $derived(chatRecordingEvidence(capture));
  const items = $derived<DockComposerAttachment[]>(
    evidence?.clips.map((clip) => ({
      id: clip.contextItemId!,
      kind: 'clip',
      owner: 'evidence',
      duration: formatDockElapsed(clip.durationMs),
      recording: false,
      url: capture ? dockClipPlaybackUrl(capture.workspaceId, clip.path) : undefined,
      ...(clip.media?.saved ? { summary: dockClipSendSummary(clip.media.saved) } : {}),
    })) ?? [],
  );
  let dialog = $state<HTMLElement | null>(null);
</script>

<DockComposerAttachments
  {items}
  {labels}
  disabled={disabled || controller.opening}
  onEdit={(id) => void controller.open(id)}
  onMarkUp={(id) => void controller.open(id)}
  onRemove={controller.remove}
/>
{#if controller.problem}<p role="alert">{m.dock_captureEditor_saveFailed_label()}</p>{/if}
<ContentDialog
  open={!!controller.session}
  bind:contentRef={dialog}
  size="editor"
  showCloseButton={false}
  title={m.dock_captureEditor_recording_title({
    duration: controller.session
      ? formatDockElapsed(controller.session.snapshot.durationMs ?? 0)
      : '',
  })}
  escapeKeydownBehavior="ignore"
  dismissOnInteractOutside={false}
  onClose={() => controller.close()}
  onCloseAutoFocus={(event) => {
    event.preventDefault();
    controller.restoreFocus();
  }}
>
  {#if controller.session}
    {#key controller.session.snapshot.openId}
      <div class="recording-editor-surface">
        <DockRecordingEditor
          snapshot={controller.session.snapshot}
          shortcutDialog={dialog}
          onClose={() => controller.close()}
          onSave={controller.save}
          onDelete={async () =>
            !!controller.session && controller.remove(controller.session.contextItemId)}
        />
      </div>
    {/key}
  {/if}
</ContentDialog>

<style>
  .recording-editor-surface {
    height: min(70dvh, 48rem);
    min-height: 22rem;
  }
</style>
