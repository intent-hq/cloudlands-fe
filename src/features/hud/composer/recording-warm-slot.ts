import {
  defaultDockMediaEdit,
  planDockMediaOutput,
  type DockSavedMedia,
} from '$shared/dock-media-edit';
import type { DockMediaSendService } from './dock-media-send';
import { dockMediaSendsOriginal } from './dock-media-send';
import { exportRecording, type PreparedRecordingExport } from './recording-export';

/** One owner-local speculative job. Never shares paths across composers or places files. */
export function createRecordingWarmSlot(service: DockMediaSendService) {
  type Entry = {
    key: string;
    mediaKey: string;
    id: string;
    current: () => boolean;
    taken: boolean;
    stopped: boolean;
    settled: boolean;
    failed: boolean;
    timer: ReturnType<typeof setTimeout>;
    result: Promise<{ value: PreparedRecordingExport } | { error: unknown }>;
  };
  let entry: Entry | null = null;
  let suppressed: string | null = null;
  const release = (id: string) => service.releaseMediaJob?.(id).catch(() => {});
  function cancel() {
    const old = entry;
    entry = null;
    if (!old || old.taken || old.stopped) return;
    old.stopped = true;
    clearTimeout(old.timer);
    // Release now cancels an existing child. The completion fence also releases a
    // job created after this cancellation reached main's asynchronous admission.
    void release(old.id);
  }
  function warm(key: string, original: DockSavedMedia, current: () => boolean) {
    if (entry?.key === key || suppressed === key) return;
    cancel();
    suppressed = null;
    if (
      !service.adoptMediaJob ||
      !service.exportMedia ||
      !current() ||
      dockMediaSendsOriginal(original)
    )
      return;
    const media = structuredClone(original);
    const edit =
      media.saved ??
      defaultDockMediaEdit(media.source, media.source.capturedMarks ?? [], media.transcript);
    const plan = planDockMediaOutput(edit, media.source, media.transcript);
    if (
      media.source.kind !== 'recording' ||
      media.source.visuals !== 'clean' ||
      plan.errors.length ||
      !plan.clips.length ||
      (edit.voice === 'transcript' && media.transcript?.status !== 'ready')
    )
      return;
    const normalized = { ...media, saved: edit };
    const id = crypto.randomUUID();
    const own: Entry = {
      key,
      mediaKey: JSON.stringify(normalized),
      id,
      current,
      taken: false,
      stopped: false,
      settled: false,
      failed: false,
      timer: setTimeout(() => {
        if (entry === own) {
          suppressed = key;
          cancel();
        }
      }, 30_000),
      result: Promise.resolve({ error: new Error('not-started') }),
    };
    entry = own;
    own.result = exportRecording(normalized, id, service, () => !own.stopped && own.current())
      .then(
        async (value) => {
          if (own.stopped || !own.current()) {
            await release(id);
            return { error: new Error('media-send-retired') };
          }
          return { value };
        },
        async (error: unknown) => {
          own.failed = true;
          if (entry === own) suppressed = key;
          await release(id);
          return { error };
        },
      )
      .finally(() => {
        own.settled = true;
      });
  }
  async function take(
    key: string,
    media: DockSavedMedia,
    current: () => boolean,
  ): Promise<PreparedRecordingExport | null> {
    const own = entry;
    if (
      !own ||
      own.key !== key ||
      own.mediaKey !== JSON.stringify(media) ||
      own.stopped ||
      own.taken ||
      !current()
    )
      return null;
    // A failure already observed in the background permits this explicit cold Send.
    if (own.failed && own.settled) {
      cancel();
      return null;
    }
    own.taken = true;
    own.current = current;
    clearTimeout(own.timer);
    entry = null;
    const result = await own.result;
    // A matching pending job's failure is the send's failure; never retry silently.
    if ('error' in result) throw result.error;
    try {
      if (!current()) throw new Error('media-send-retired');
      const live = await service.adoptMediaJob?.(own.id);
      if (!current()) throw new Error('media-send-retired');
      if (!live?.ok || !live.value) {
        await release(own.id);
        return null;
      }
      return result.value;
    } catch (error) {
      await release(own.id);
      throw error;
    }
  }
  return { warm, take, cancel };
}
