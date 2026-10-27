<script lang="ts">
  import { onMount } from 'svelte';
  import { takeEvery } from 'typed-redux-saga';
  import { store } from '$store/renderer/store';
  import { annotationSaga } from '$store/renderer/slices/annotation/sagas/annotation-saga';
  import {
    annotationDraftStarted,
    annotationMessageChanged,
    addAnnotationTranscriptRequested,
    submitAnnotationRequested,
  } from '$store/renderer/slices/annotation/annotation-slice';
  import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
  import { IPC_CHANNELS } from '$shared/ipc-registry';
  import { overrideMockIpcHandler } from '$shared/ipc-mock-router';
  import { installMockElectronBridge } from '../../../../test/ct-mock-electron-bridge';
  import {
    createAnnotationVoiceController,
    type AnnotationVoiceController,
  } from '../../annotation-voice-service';
  import { encodeWavPcm16 } from '$features/voice/utils/wav-encoder';
  import type { AnnotationSubmission } from '../../annotation-types';

  let { scenario }: { scenario: 'retired' | 'duplicate' | 'uncertain' | 'voice' } = $props();
  let ready = $state(false);
  let outcomes = $state<string[]>([]);
  let requests = $state<{ method: string; params: unknown }[]>([]);
  let voiceStatus = $state('idle');
  let voiceReplies = $state(0);
  let transcriptActions = $state(0);
  let draftMessage = $state('');
  let resolveDelivery = () => {};
  let resolveVoice = () => {};
  let voice: AnnotationVoiceController;
  const messageId = 'feedback-boundary-message';
  let submission: AnnotationSubmission;
  const record = (method: string, params: unknown) => {
    requests = [...requests, { method, params }];
  };

  onMount(() => {
    const priorBridge = window.electronAPI;
    // eslint-disable-next-line intent/no-component-async-data-fetch -- browser fixture replaces IPC while exercising the production delivery saga
    installMockElectronBridge({
      'agent.get': (params) => {
        record('agent.get', params);
        return {
          agent: {
            id: 'feedback-test-agent',
            workspaceId: CHIEF_WORKSPACE_ID,
            name: 'Assistant',
            status: 'idle',
            retiredAt: scenario === 'retired' ? '2026-10-19T00:00:00Z' : null,
          },
        };
      },
      'agent.sendMessage': async (params) => {
        record('agent.sendMessage', params);
        if (scenario === 'uncertain') throw new Error('Connection lost after acceptance');
        if (scenario === 'duplicate')
          await new Promise<void>((resolve) => {
            resolveDelivery = resolve;
          });
        return { success: true };
      },
      'agent.getQueue': (params) => {
        record('agent.getQueue', params);
        return { success: true, queue: [{ id: 'accepted-queue-row', submissionIds: [messageId] }] };
      },
      'agent.getConversation': (params) => {
        record('agent.getConversation', params);
        return { messages: [], truncated: false, totalMessages: 0, nextToken: null };
      },
      'voice.getWorkspaceVocabulary': (params) => {
        record('voice.getWorkspaceVocabulary', params);
        return { terms: [] };
      },
    });
    // eslint-disable-next-line intent/no-component-async-data-fetch -- browser fixture controls when the synthetic transcript arrives
    const restoreVoice = overrideMockIpcHandler(IPC_CHANNELS.VOICE.TRANSCRIBE_LOCAL, async () => {
      record('voice:transcribe-local', {});
      await new Promise<void>((resolve) => {
        resolveVoice = resolve;
      });
      voiceReplies += 1;
      return { success: true, text: 'Late voice must not revive this draft.', durationMs: 100 };
    });
    const originalMediaRecorder = window.MediaRecorder;
    const originalGetUserMedia = navigator.mediaDevices.getUserMedia;
    // Only the media acquisition boundary is fake; production recording,
    // WAV conversion, OS transcription service and cancellation guard run.
    class SyntheticMediaRecorder {
      static isTypeSupported() {
        return true;
      }
      mimeType = 'audio/wav';
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      onerror: ((event: unknown) => void) | null = null;
      start() {}
      stop() {
        this.ondataavailable?.({
          data: new Blob([encodeWavPcm16(new Float32Array(1600), 16000)], { type: 'audio/wav' }),
        });
        this.onstop?.();
      }
    }
    window.MediaRecorder = SyntheticMediaRecorder as unknown as typeof MediaRecorder;
    navigator.mediaDevices.getUserMedia = async () => new MediaStream();
    store.dispatch(annotationDraftStarted(Date.now()));
    store.dispatch(annotationMessageChanged('Draft survives cancellation.'));
    const stopState = store.getReadableState().subscribe((state) => {
      draftMessage = state.annotation.draft.message;
    });
    const stopAudit = store.runSaga(function* () {
      yield* takeEvery(addAnnotationTranscriptRequested, function* () {
        transcriptActions += 1;
      });
    });
    const stopSaga = store.runSaga(annotationSaga);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 2;
    submission = {
      messageId,
      sourceWorkspaceId: 'feedback-test-workspace',
      sourceWorkspaceTitle: 'Feedback safety',
      recipient: {
        id: 'existing-assistant',
        agentId: 'feedback-test-agent',
        workspaceId: CHIEF_WORKSPACE_ID,
        name: 'Assistant',
        kind: 'assistant',
      },
      message: 'Keep this draft and capture on retry.',
      frames: [
        {
          id: 'capture-one',
          imageDataUrl: canvas.toDataURL('image/png'),
          elapsedMs: 1200,
          pins: [],
        },
      ],
    };
    // eslint-disable-next-line intent/no-component-async-data-fetch -- browser fixture exercises the real voice controller with fake media and IPC
    voice = createAnnotationVoiceController('feedback-voice-test', {
      onStatus: (status) => {
        voiceStatus = status;
      },
      onError: (error) => {
        outcomes = [...outcomes, String(error)];
      },
    });
    ready = true;
    return () => {
      voice.cancel();
      resolveVoice();
      resolveDelivery();
      stopSaga();
      stopAudit();
      stopState();
      restoreVoice();
      window.electronAPI = priorBridge;
      window.MediaRecorder = originalMediaRecorder;
      navigator.mediaDevices.getUserMedia = originalGetUserMedia;
    };
  });

  function send() {
    const action = submitAnnotationRequested(submission);
    store.dispatch(action);
    void action.promise.then(
      () => {
        outcomes = [...outcomes, 'sent'];
      },
      (error: Error) => {
        outcomes = [...outcomes, error.message];
      },
    );
  }
</script>

<section
  data-testid="delivery-boundary"
  data-ready={ready}
  data-evidence={JSON.stringify({
    requests,
    outcomes,
    voiceStatus,
    voiceReplies,
    transcriptActions,
    draftMessage,
    messageId,
  })}
>
  <button onclick={send} disabled={!ready}>Send</button>
  <button onclick={() => resolveDelivery()}>Release delivery</button>
  <button onclick={() => void voice.start()}>Start voice</button>
  <button onclick={() => void voice.stop()}>Stop voice</button>
  <button
    onclick={() => {
      voice.cancel();
      voiceStatus = 'cancelled';
    }}>Cancel voice</button
  >
  <button onclick={() => resolveVoice()}>Deliver late voice</button>
  <pre>{JSON.stringify(
      { requests, outcomes, voiceStatus, voiceReplies, transcriptActions, draftMessage },
      null,
      2,
    )}</pre>
</section>
