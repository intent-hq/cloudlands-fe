import { electronAPI } from '$lib/electron-bridge';
import { detectPlatform } from '$lib/utils/platform-capabilities';
import { ANNOTATION_CHANNELS } from '$shared/ipc/channels';

export type AnnotationInvokeChannel =
  | typeof ANNOTATION_CHANNELS.START
  | typeof ANNOTATION_CHANNELS.GET_STATE
  | typeof ANNOTATION_CHANNELS.SET_TOOL
  | typeof ANNOTATION_CHANNELS.ADD_TRANSCRIPT
  | typeof ANNOTATION_CHANNELS.SET_TOOLBAR_LAYOUT
  | typeof ANNOTATION_CHANNELS.SET_DESTINATION
  | typeof ANNOTATION_CHANNELS.REQUEST_SEND
  | typeof ANNOTATION_CHANNELS.REQUEST_SCREENSHOT
  | typeof ANNOTATION_CHANNELS.REPORT_SCREENSHOT
  | typeof ANNOTATION_CHANNELS.REPORT_DELIVERY
  | typeof ANNOTATION_CHANNELS.REVIEW
  | typeof ANNOTATION_CHANNELS.CLOSE;

function browserResult(channel: AnnotationInvokeChannel): unknown {
  if (channel === ANNOTATION_CHANNELS.START) {
    return { success: false, error: 'Annotation mode requires the native Electron app.' };
  }
  return { success: false };
}

export async function invokeAnnotationTransport<T>(
  channel: AnnotationInvokeChannel,
  payload: unknown,
): Promise<T> {
  if (typeof window === 'undefined' || detectPlatform(window) !== 'electron') {
    return browserResult(channel) as T;
  }
  return (await electronAPI().invoke(channel, payload)) as T;
}
