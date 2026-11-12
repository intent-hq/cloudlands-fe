import { detectPlatform } from '$lib/utils/platform-capabilities';
import { electronAPI } from '$lib/electron-bridge';
import {
  CHAT_MEDIA_CHANNELS,
  type ChatMediaBegin,
  type ChatMediaControl,
} from '$shared/chat-media-ipc';
import type { DockNativeResult } from '$shared/dock-evidence';
import type { DockMediaSendService } from './dock-media-send';

type Invoke = (
  channel: (typeof CHAT_MEDIA_CHANNELS)[keyof typeof CHAT_MEDIA_CHANNELS],
  request: unknown,
) => Promise<unknown>;
/** A send-scoped offline adapter, never a dock/native-capture adapter. */
export function createChatMediaNative(
  request: ChatMediaBegin,
  current: () => boolean,
  signal: AbortSignal,
  invoke: Invoke = async (channel, value) => {
    if (typeof window === 'undefined' || detectPlatform(window) !== 'electron')
      return { ok: false, error: 'unavailable' };
    return electronAPI().invoke(channel, value);
  },
) {
  let sessionId: string | null = null;
  let starting: Promise<string> | null = null;
  let disposed = false;
  async function dispose(): Promise<void> {
    disposed = true;
    signal.removeEventListener('abort', onAbort);
    const id = sessionId;
    sessionId = null;
    if (id) await invoke(CHAT_MEDIA_CHANNELS.CLOSE, { sessionId: id }).catch(() => {});
  }
  const onAbort = () => {
    void dispose();
  };
  signal.addEventListener('abort', onAbort, { once: true });
  const check = () => {
    if (disposed || signal.aborted || !current()) throw new Error('media-send-retired');
  };
  async function begin(): Promise<string> {
    check();
    if (sessionId) return sessionId;
    if (starting) return starting;
    starting = (async () => {
      const result = (await invoke(CHAT_MEDIA_CHANNELS.BEGIN, request)) as DockNativeResult<{
        sessionId: string;
      }>;
      if (!result.ok) throw new Error('media-export-unavailable');
      sessionId = result.value.sessionId;
      try {
        check();
        return sessionId;
      } catch (error) {
        await dispose();
        throw error;
      }
    })();
    try {
      return await starting;
    } finally {
      starting = null;
    }
  }
  async function control<T>(control: ChatMediaControl['control']): Promise<DockNativeResult<T>> {
    const id = await begin();
    check();
    const result = (await invoke(CHAT_MEDIA_CHANNELS.CONTROL, {
      sessionId: id,
      control,
    })) as DockNativeResult<T>;
    check();
    return result;
  }
  const service: DockMediaSendService = {
    exportMedia: (request) => control({ action: 'export', request }),
    transcribeMedia: (request) => control({ action: 'transcribe', request }),
    releaseMediaJob: async (jobId) => {
      if (!sessionId) return { ok: true, value: undefined };
      return (await invoke(CHAT_MEDIA_CHANNELS.CONTROL, {
        sessionId,
        control: { action: 'release', jobId },
      })) as DockNativeResult<void>;
    },
  };
  return { service, dispose };
}
