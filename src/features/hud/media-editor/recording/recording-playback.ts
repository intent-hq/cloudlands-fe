import { nextKeptTime, type RecordingRange } from './recording-editor-model';

/** A single source video, playing kept source intervals without restarting its timeline. */
export function createRecordingPlayback(
  video: HTMLVideoElement,
  ranges: () => readonly RecordingRange[],
  changed: (sourceMs: number, paused: boolean) => void,
) {
  let wanted = false;
  let disposed = false;
  let joining = false;
  let frame: number | undefined;
  let playVersion = 0;
  // Seconds -> milliseconds can round just below a fractional cut boundary.
  const EPSILON_MS = 0.5;
  const publish = () => changed(video.currentTime * 1000, !wanted);
  function schedule() {
    if (!disposed && wanted && frame === undefined) frame = requestAnimationFrame(tick);
  }
  function cancelFrame() {
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
  }
  function pause() {
    wanted = false;
    joining = false;
    playVersion++;
    cancelFrame();
    video.pause();
    publish();
  }
  function targetAt(ms: number): number | null {
    const kept = ranges();
    // Accept only sub-millisecond roundoff at the start of an actual kept interval.
    const atStart = kept.find((range) => ms < range.startMs && range.startMs - ms <= EPSILON_MS);
    return atStart ? ms : nextKeptTime(ms, kept);
  }
  function setTime(ms: number) {
    if (Math.abs(video.currentTime * 1000 - ms) <= EPSILON_MS) return;
    joining = wanted;
    video.currentTime = ms / 1000;
  }
  function finish() {
    const end = ranges().at(-1)?.endMs ?? 0;
    pause();
    setTime(end);
    publish();
  }
  function reconcile() {
    if (disposed) return;
    const kept = ranges();
    if (!kept.length) {
      pause();
      return;
    }
    // Do not restart a pending native seek on every animation frame.
    if (!video.seeking) {
      const at = video.currentTime * 1000,
        next = targetAt(at);
      if (next === null) {
        if (wanted) {
          finish();
          return;
        }
        setTime(kept.at(-1)?.endMs ?? 0);
      } else if (next > at + EPSILON_MS) setTime(next);
    }
    publish();
    schedule();
  }
  function tick() {
    frame = undefined;
    reconcile();
  }
  async function resume() {
    const version = ++playVersion;
    try {
      await video.play();
    } catch {
      if (disposed || version !== playVersion || !wanted) return;
      // A seek can interrupt play(). Its completion owns the next play attempt.
      if (!video.seeking) pause();
    }
  }
  function play() {
    if (disposed || !ranges().length) return;
    const kept = ranges(),
      at = video.currentTime * 1000;
    const next = targetAt(at);
    wanted = true;
    if (next === null || at >= (kept.at(-1)?.endMs ?? 0) - EPSILON_MS) setTime(kept[0].startMs);
    else if (next > at + EPSILON_MS) setTime(next);
    publish();
    schedule();
    void resume();
  }
  function seek(ms: number) {
    if (disposed) return;
    const kept = ranges();
    const next = nextKeptTime(Math.max(0, ms), kept) ?? kept.at(-1)?.endMs ?? 0;
    setTime(next);
    publish();
    schedule();
  }
  const onSeeked = () => {
    joining = false;
    reconcile();
    if (wanted && video.paused) void resume();
  };
  const onPause = () => {
    if (wanted && joining) return;
    wanted = false;
    cancelFrame();
    publish();
  };
  const onPlay = () => {
    if (!wanted || disposed) {
      video.pause();
      return;
    }
    schedule();
    publish();
  };
  const onEnded = () => {
    if (wanted) finish();
    else publish();
  };
  const onTime = () => {
    if (!video.seeking) reconcile();
  };
  video.addEventListener('seeked', onSeeked);
  video.addEventListener('pause', onPause);
  video.addEventListener('play', onPlay);
  video.addEventListener('ended', onEnded);
  video.addEventListener('timeupdate', onTime);
  video.addEventListener('loadedmetadata', onTime);
  return {
    play,
    pause,
    seek,
    refresh: reconcile,
    toggle: () => (wanted ? pause() : play()),
    destroy() {
      disposed = true;
      pause();
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('timeupdate', onTime);
      video.removeEventListener('loadedmetadata', onTime);
    },
  };
}
