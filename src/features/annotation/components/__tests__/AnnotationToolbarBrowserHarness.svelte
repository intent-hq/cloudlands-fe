<script lang="ts">
  import { onMount } from 'svelte';
  import AnnotationToolbar from '../AnnotationToolbar.svelte';
  import { store } from '$store/renderer/store';
  import { annotationSaga } from '$store/renderer/slices/annotation/sagas/annotation-saga';
  import {
    annotationDraftStarted,
    annotationMessageChanged,
    annotationStateReceived,
  } from '$store/renderer/slices/annotation/annotation-slice';
  import type {
    AnnotationSessionState,
    RequestAnnotationSendRequest,
    SetAnnotationDestinationRequest,
  } from '$shared/annotation';
  import { createAgentId, createWorkspaceId } from '$shared/types/branded-ids';
  import { IPC_CHANNELS } from '$shared/ipc-registry';
  import { overrideMockIpcHandler } from '$shared/ipc-mock-router';
  import { installMockElectronBridge } from '../../../../test/ct-mock-electron-bridge';
  import { encodeWavPcm16 } from '$features/voice/utils/wav-encoder';

  let ready = $state(false);
  let acquisitions = $state(0);
  let voiceRequests = $state(0);
  let voiceReplies = $state(0);
  let reviewRequests = $state(0);
  let sendRequests = $state<
    {
      request: RequestAnnotationSendRequest;
      destination: AnnotationSessionState['destination'];
      transcripts: string[];
    }[]
  >([]);
  let sessionStartedAt = $state(0);
  let closeRequests = $state(0);
  let transcripts = $state<string[]>([]);
  let draftMessage = $state('');

  onMount(() => {
    const priorBridge = window.electronAPI;
    const originalMediaRecorder = window.MediaRecorder;
    const originalGetUserMedia = navigator.mediaDevices.getUserMedia;
    let releaseMicrophone = () => {};
    let releaseVoice = () => {};
    const grantMicrophone = () => releaseMicrophone();
    const deliverVoice = () => releaseVoice();
    const session: AnnotationSessionState = {
      workspaceId: createWorkspaceId('toolbar-browser'),
      workspaceTitle: 'Navigation feedback',
      tool: 'mouse',
      phase: 'capturing',
      screenshotDataUrl: '',
      screenshotRevision: 1,
      startedAt: Date.now(),
      transcripts: [],
      destination: {
        workspaceId: createWorkspaceId('toolbar-browser'),
        workspaceTitle: 'Navigation feedback',
        agentId: null,
      },
      delivery: { status: 'idle' },
    };
    // eslint-disable-next-line intent/no-component-async-data-fetch -- browser fixture replaces only the external daemon boundary
    installMockElectronBridge({
      'voice.getWorkspaceVocabulary': () => ({ terms: [] }),
      'workspace.list': () => ({
        workspaces: [{ id: session.workspaceId, title: session.workspaceTitle, status: 'active' }],
      }),
      'agent.list': (params) => ({
        agents:
          (params as { scope: string }).scope === 'topLevel'
            ? [
                {
                  id: createAgentId('agent-toolbar-main'),
                  workspaceId: session.workspaceId,
                  name: 'Main agent',
                  status: 'idle',
                  isInitialAgent: true,
                },
              ]
            : [],
      }),
    });
    // Annotation transport requires a native bridge. Every invoke remains synthetic.
    Object.assign(window.electronAPI!, { versions: { electron: 'toolbar-browser-test' } });
    const restores = [
      // eslint-disable-next-line intent/no-component-async-data-fetch -- browser fixture supplies a native session to the real annotation saga
      overrideMockIpcHandler(IPC_CHANNELS.ANNOTATION.GET_STATE, () => ({
        success: true,
        state: session,
      })),
      // eslint-disable-next-line intent/no-component-async-data-fetch -- browser fixture records actual tool requests without a native window
      overrideMockIpcHandler(IPC_CHANNELS.ANNOTATION.SET_TOOL, (payload) => {
        session.tool = (payload as { tool: AnnotationSessionState['tool'] }).tool;
        store.dispatch(annotationStateReceived({ ...session }));
        return { success: true };
      }),
      // eslint-disable-next-line intent/no-component-async-data-fetch -- browser fixture audits real transcript delivery requests
      overrideMockIpcHandler(IPC_CHANNELS.ANNOTATION.ADD_TRANSCRIPT, (payload) => {
        transcripts = [...transcripts, (payload as { text: string }).text];
        session.transcripts = [...transcripts];
        return { success: true };
      }),
      // eslint-disable-next-line intent/no-component-async-data-fetch -- browser fixture accepts native toolbar geometry
      overrideMockIpcHandler(IPC_CHANNELS.ANNOTATION.SET_TOOLBAR_LAYOUT, () => ({ success: true })),
      // eslint-disable-next-line intent/no-component-async-data-fetch -- browser fixture persists the actual destination request
      overrideMockIpcHandler(IPC_CHANNELS.ANNOTATION.SET_DESTINATION, (payload) => {
        session.destination = { ...(payload as SetAnnotationDestinationRequest).destination };
        store.dispatch(annotationStateReceived({ ...session }));
        return { success: true };
      }),
      // eslint-disable-next-line intent/no-component-async-data-fetch -- browser fixture snapshots transcripts at the real send boundary
      overrideMockIpcHandler(IPC_CHANNELS.ANNOTATION.REQUEST_SEND, (payload) => {
        sendRequests = [
          ...sendRequests,
          {
            request: { ...(payload as RequestAnnotationSendRequest) },
            destination: session.destination && { ...session.destination },
            transcripts: [...session.transcripts],
          },
        ];
        return { success: true };
      }),
      // eslint-disable-next-line intent/no-component-async-data-fetch -- browser fixture audits real review requests without opening a window
      overrideMockIpcHandler(IPC_CHANNELS.ANNOTATION.REVIEW, () => {
        reviewRequests += 1;
        return { success: true };
      }),
      // eslint-disable-next-line intent/no-component-async-data-fetch -- browser fixture audits cancellation without destroying the test page
      overrideMockIpcHandler(IPC_CHANNELS.ANNOTATION.CLOSE, () => {
        closeRequests += 1;
        return { success: true };
      }),
      // eslint-disable-next-line intent/no-component-async-data-fetch -- browser fixture controls completion of the external OS speech request
      overrideMockIpcHandler(IPC_CHANNELS.VOICE.TRANSCRIBE_LOCAL, async () => {
        voiceRequests += 1;
        await new Promise<void>((resolve) => {
          releaseVoice = resolve;
        });
        voiceReplies += 1;
        return { success: true, text: 'Keep the navigation visible.', durationMs: 100 };
      }),
    ];
    // Actual controller, recorder, WAV conversion, and OS speech service run;
    // synthetic media is the only microphone input.
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
    navigator.mediaDevices.getUserMedia = async () => {
      acquisitions += 1;
      await new Promise<void>((resolve) => {
        releaseMicrophone = resolve;
      });
      return new MediaStream();
    };
    window.addEventListener('annotation-test-grant-microphone', grantMicrophone);
    window.addEventListener('annotation-test-deliver-voice', deliverVoice);
    sessionStartedAt = session.startedAt;
    store.dispatch(annotationDraftStarted(session.startedAt));
    store.dispatch(annotationMessageChanged('Preserve this feedback draft.'));
    const stopState = store.getReadableState().subscribe((state) => {
      draftMessage = state.annotation.draft.message;
    });
    const stopSaga = store.runSaga(annotationSaga);
    ready = true;
    return () => {
      releaseMicrophone();
      releaseVoice();
      stopSaga();
      stopState();
      for (const restore of restores) restore();
      window.removeEventListener('annotation-test-grant-microphone', grantMicrophone);
      window.removeEventListener('annotation-test-deliver-voice', deliverVoice);
      window.electronAPI = priorBridge;
      window.MediaRecorder = originalMediaRecorder;
      navigator.mediaDevices.getUserMedia = originalGetUserMedia;
    };
  });
</script>

<div
  data-testid="toolbar-browser-host"
  data-ready={ready}
  data-evidence={JSON.stringify({
    acquisitions,
    voiceRequests,
    voiceReplies,
    reviewRequests,
    sendRequests,
    sessionStartedAt,
    closeRequests,
    transcripts,
    draftMessage,
  })}
>
  {#if ready}<AnnotationToolbar />{/if}
</div>
