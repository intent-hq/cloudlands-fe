import { dockMediaOverlaySpans, dockMediaFrameAt } from '../../../shared/dock-media-animation';
import { Logger } from '../../../shared/logger';
import { DockMediaWaveformSchema, DockMediaAudioProbeSchema, type DockMediaAudioProbeRequest, type DockMediaAudioProbe, type DockMediaAnalyzeRequest, type DockMediaWaveform } from '../../../shared/dock-media-output';
/** Session-bound offline jobs. No renderer-chosen host paths or backend fallback. */
import { app, nativeImage } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { access, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  defaultDockMediaEdit, planDockMediaOutput, DockMediaTranscriptSchema, DOCK_MEDIA_BLUR_RADIUS, DOCK_MEDIA_OUTPUT_VERSION,
  type DockSavedMedia,
} from '../../../shared/dock-media-edit';
import type { DockMediaExportRequest, DockMediaNativeOutput, DockMediaTranscribeRequest } from '../../../shared/dock-media-output';
import type { DockNativeResult } from '../../../shared/dock-evidence';
import type { DockEvidenceContext } from './dock-evidence-session';
import { requestRouted } from '../../backend/main/transfer-connections';

const logger = new Logger('DockMediaOutput');
const TRANSCRIPT_CODES = new Set(['speech-not-authorized', 'on-device-unavailable', 'recognition-timeout',
  'no-audio-track', 'audio-duration-unsupported', 'audio-format', 'audio-reader', 'audio-buffer', 'audio-buffer-copy',
  'audio-timing', 'audio-decode-failed', 'audio-reader-failed', 'audio-sample', 'recognition-alignment', 'invalid-job', 'recognition-failed']);
class DockMediaJobError extends Error {
  constructor(readonly code: string, readonly nativeDomain?: string, readonly nativeCode?: number) { super(code); }
}
const MAX_BYTES = 128 * 1024 * 1024;
const jobs = new Map<string, Job>();
interface Job {
  sessionId: string; id: string; fingerprint: string; directory: string;
  child?: ChildProcessWithoutNullStreams; stopped: boolean; done?: Promise<void>;
  stopWatching: () => void; expiry: ReturnType<typeof setTimeout>;
}
function check(context: DockEvidenceContext, job?: Job) {
  if (!context.isCurrent() || job?.stopped) throw new Error('media-session-retired');
}
async function helper(name: string): Promise<string> {
  if (process.platform !== 'darwin') throw new Error('media-platform-unavailable');
  const roots = app.isPackaged ? [process.resourcesPath] : [
    path.join(app.getAppPath(), 'resources'), path.resolve(app.getAppPath(), '..', '..', 'resources'),
  ];
  for (const root of roots) {
    const file = path.join(root, 'dock-helper', name);
    try { await access(file); return file; } catch { /* next known app layout */ }
  }
  throw new Error('media-helper-unavailable');
}
/** Old helpers may decode unknown JSON fields without applying them. Probe first,
 * then require the same version in the actual completion before any placement. */
async function requireExporterVersion(binary: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(binary, ['--capability'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let text = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('media-capability-timeout')); }, 2000);
    timer.unref(); child.stdin.on('error', (error) => { clearTimeout(timer); reject(error); }); child.stdin.end(); child.stderr.resume();
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.stdout.on('data', (bytes: Buffer) => {
      text += bytes.toString('utf8');
      if (text.length > 16384) { child.kill('SIGKILL'); reject(new Error('media-capability-invalid')); }
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      try {
        const value = JSON.parse(text.trim()) as Record<string, unknown>;
        if (code !== 0 || value.event !== 'capability' || value.outputVersion !== DOCK_MEDIA_OUTPUT_VERSION ||
          !Array.isArray(value.features) || !value.features.includes('blur-strokes')) throw new Error('media-capability-unavailable');
        resolve();
      } catch (error) { reject(error); }
    });
  });
}
export async function dockMediaOutputReady(source: DockSavedMedia['source'], _saved?: DockSavedMedia['saved']): Promise<{ ready: boolean; version?: number; reason?: 'legacy-baked-marks' }> {
  if (source.visuals !== 'clean') return { ready: false, reason: 'legacy-baked-marks' };
  if (source.kind === 'screenshot') return { ready: true, version: DOCK_MEDIA_OUTPUT_VERSION };
  try { await requireExporterVersion(await helper('intent-dock-media-export')); return { ready: true, version: DOCK_MEDIA_OUTPUT_VERSION }; }
  catch { return { ready: false }; }
}
async function createJob(context: DockEvidenceContext, id: string, fingerprint: string): Promise<Job> {
  check(context);
  const key = `${context.scope.sessionId}:${id}`;
  if (jobs.has(key) || [...jobs.values()].filter((job) => job.sessionId === context.scope.sessionId).length >= 2)
    throw new Error('media-job-busy');
  const root = path.join(app.getPath('userData'), 'dock-media-jobs');
  await mkdir(root, { recursive: true, mode: 0o700 });
  check(context);
  const directory = await mkdtemp(path.join(root, 'job-'));
  if (!context.isCurrent() || jobs.has(key) || [...jobs.values()].filter((entry) => entry.sessionId === context.scope.sessionId).length >= 2) {
    await rm(directory, { recursive: true, force: true });
    throw new Error('media-job-busy');
  }
  const job: Job = { sessionId: context.scope.sessionId, id, fingerprint, directory, stopped: false,
    stopWatching: () => {}, expiry: setTimeout(() => { void releaseDockMediaJob(context.scope.sessionId, id); }, 10 * 60_000) };
  job.expiry.unref();
  jobs.set(key, job);
  job.stopWatching = context.onDispose(() => { void releaseDockMediaJob(context.scope.sessionId, id); });
  check(context, job);
  return job;
}
export async function releaseDockMediaJob(sessionId: string, id: string): Promise<void> {
  const key = `${sessionId}:${id}`, job = jobs.get(key);
  if (!job) return;
  job.stopped = true;
  clearTimeout(job.expiry); job.stopWatching();
  if (job.child && job.child.exitCode === null && job.child.signalCode === null) {
    job.child.kill('SIGTERM');
    const force = setTimeout(() => job.child?.kill('SIGKILL'), 2000);
    force.unref();
    await job.done?.catch(() => {});
    clearTimeout(force);
  }
  await rm(job.directory, { recursive: true, force: true });
  if (jobs.get(key) === job) jobs.delete(key);
}
async function copySource(context: DockEvidenceContext, job: Job, media: DockSavedMedia): Promise<string> {
  const { getBackendClientForId } = await import('../../backend/main/backend.ipc');
  const client = getBackendClientForId(context.backendId);
  const current = () => { check(context, job); if (getBackendClientForId(context.backendId) !== client) throw new Error('media-backend-changed'); };
  current();
  const source = media.source;
  const info = await client.request<{ attachmentId: string; path: string; size: number; exists: boolean }>('file.getAttachmentInfo', {
    workspaceId: context.scope.workspaceId, attachmentId: source.attachmentId,
  });
  current();
  if (!info.exists || info.attachmentId !== source.attachmentId || info.path !== source.path ||
      !Number.isSafeInteger(info.size) || info.size <= 0 || info.size > MAX_BYTES) throw new Error('media-source-missing');
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < info.size;) {
    current();
    const length = Math.min(1024 * 1024, info.size - offset);
    const chunk = await requestRouted<{ size: number; bytesRead: number; content: string }>(client, 'file.readChunk', {
      workspaceId: context.scope.workspaceId, path: source.path, offset, length,
    }, { timeoutMs: 30_000 }, context.backendId);
    current();
    if (chunk.size !== info.size || chunk.bytesRead !== length || typeof chunk.content !== 'string') throw new Error('media-source-changed');
    const bytes = Buffer.from(chunk.content, 'base64');
    if (bytes.length !== length) throw new Error('media-source-incomplete');
    chunks.push(bytes); offset += length;
  }
  const file = path.join(job.directory, 'source.mp4');
  await writeFile(file, Buffer.concat(chunks), { flag: 'wx', mode: 0o600 });
  current();
  return file;
}
async function run(context: DockEvidenceContext, job: Job, binary: string, input: object,
  progress: (fraction: number) => void, timeoutMs = 5 * 60_000): Promise<Record<string, unknown>> {
  check(context, job);
  const child = spawn(binary, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  job.child = child;
  let finish!: () => void;
  job.done = new Promise<void>((resolve) => { finish = resolve; });
  let buffer = '', total = 0, completed: Record<string, unknown> | undefined;
  let nativeFailure: DockMediaJobError | undefined;
  let forceStop: ReturnType<typeof setTimeout> | undefined;
  const timeout = setTimeout(() => {
    job.stopped = true; child.kill('SIGTERM');
    forceStop = setTimeout(() => child.kill('SIGKILL'), 2000); forceStop.unref();
  }, timeoutMs);
  timeout.unref();
  try {
    return await new Promise((resolve, reject) => {
      const fail = () => reject(nativeFailure ?? new DockMediaJobError('media-job-failed'));
      child.once('error', fail);
      child.stderr.resume();
      child.stdout.on('data', (bytes: Buffer) => {
        total += bytes.length;
        if (total > 16 * 1024 * 1024) { child.kill('SIGTERM'); fail(); return; }
        buffer += bytes.toString('utf8');
        let end: number;
        while ((end = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
          try {
            const event = JSON.parse(line) as Record<string, unknown>;
            if (event.event === 'progress' && typeof event.fraction === 'number' && Number.isFinite(event.fraction) && context.isCurrent() && !job.stopped)
              progress(Math.max(0, Math.min(1, event.fraction)));
            if (event.event === 'error') nativeFailure = new DockMediaJobError(
              typeof event.code === 'string' && TRANSCRIPT_CODES.has(event.code) ? event.code : 'media-job-failed',
              typeof event.nativeDomain === 'string' ? event.nativeDomain.slice(0, 128) : undefined,
              typeof event.nativeCode === 'number' && Number.isSafeInteger(event.nativeCode) ? event.nativeCode : undefined);
            if (event.event === 'complete') completed = event;
          } catch { child.kill('SIGTERM'); fail(); }
        }
      });
      child.once('close', (code) => { finish(); code === 0 && completed && !job.stopped && context.isCurrent() ? resolve(completed) : fail(); });
      child.stdin.on('error', fail);
      child.stdin.end(JSON.stringify(input));
    });
  } finally { clearTimeout(timeout); if (forceStop) clearTimeout(forceStop); }
}
export async function exportDockMedia(context: DockEvidenceContext, request: DockMediaExportRequest,
  progress: (fraction: number) => void): Promise<DockNativeResult<DockMediaNativeOutput>> {
  let job: Job | undefined;
  try {
    const { media } = request, { source } = media;
    if (source.kind !== 'recording') throw new Error('media-kind');
    const edit = media.saved ?? defaultDockMediaEdit(source, source.capturedMarks ?? [], media.transcript);
    const plan = planDockMediaOutput(edit, source, media.transcript);
    if (plan.errors.length || !plan.clips.length || source.visuals !== 'clean') throw new Error('media-plan');
    // One raster for every distinct active mark set; main determines their times.
    const spans = dockMediaOverlaySpans(source, edit);
    if (request.layers.length !== spans.length || request.layers.reduce((sum, layer) => sum + layer.png.length, 0) > MAX_BYTES) throw new Error('media-layers');
    const binary = await helper('intent-dock-media-export');
    await requireExporterVersion(binary);
    check(context);
    job = await createJob(context, request.jobId, JSON.stringify(request));
    const file = await copySource(context, job, media);
    const layers: { path: string; startMs: number; endMs: number }[] = [];
    for (let index = 0; index < spans.length; index++) {
      check(context, job);
      const layer = request.layers[index], span = spans[index];
      if (layer.atMs !== span.atMs || layer.endMs !== span.endMs) throw new Error('media-layer-time');
      const bytes = Buffer.from(layer.png, 'base64'), image = nativeImage.createFromBuffer(bytes);
      const size = image.getSize();
      if (image.isEmpty() || size.width !== source.width || size.height !== source.height) throw new Error('media-layer-size');
      const target = path.join(job.directory, `layer-${index}.png`);
      await writeFile(target, image.toPNG(), { flag: 'wx', mode: 0o600 });
      layers.push({ path: target, startMs: span.atMs, endMs: span.endMs });
    }
    const output = path.join(job.directory, 'output.mp4');
    const frames = plan.marks.map((entry, index) => {
      const atMs = dockMediaFrameAt(source, plan, entry);
      if (atMs === null) throw new Error('media-frame-outside-kept-span');
      return { path: path.join(job!.directory, `frame-${index}.png`), atMs };
    });
    const completed = await run(context, job, binary, { outputVersion: DOCK_MEDIA_OUTPUT_VERSION, source: file, output, ranges: plan.clips, muted: plan.muted, layers, frames,
      expectedWidth: source.width, expectedHeight: source.height, expectedDurationMs: source.durationMs,
      crop: edit.crop, blurRegions: edit.blurRegions, blurStrokes: edit.blurStrokes ?? [], blurRadius: DOCK_MEDIA_BLUR_RADIUS }, progress);
    check(context, job);
    if (completed.outputVersion !== DOCK_MEDIA_OUTPUT_VERSION) throw new Error('media-output-version-mismatch');
    const videoSize = (await stat(output)).size;
    if (videoSize <= 0 || videoSize > MAX_BYTES) throw new Error('media-output-size');
    const frameFiles = await Promise.all(frames.map(async (frame, index) => ({ sourcePath: frame.path, mimeType: 'image/png', size: (await stat(frame.path)).size, markId: plan.marks[index].mark.id })));
    check(context, job);
    return { ok: true, value: { jobId: job.id, video: { sourcePath: output, mimeType: 'video/mp4', size: videoSize }, frames: frameFiles } };
  } catch {
    if (job) await releaseDockMediaJob(context.scope.sessionId, job.id);
    return { ok: false, error: 'failed' };
  }
}
export async function transcribeDockMedia(context: DockEvidenceContext, request: DockMediaTranscribeRequest,
  progress: (fraction: number) => void): Promise<DockNativeResult<import('../../../shared/dock-media-edit').DockMediaTranscript>> {
  let job: Job | undefined;
  let stage: 'helper' | 'source' | 'recognition' = 'helper';
  try {
    const binary = await helper('intent-dock-media-transcribe');
    job = await createJob(context, request.jobId, JSON.stringify(request));
    stage = 'source';
    const file = await copySource(context, job, request.media);
    stage = 'recognition';
    const event = await run(context, job, binary, { source: file, audio: path.join(job.directory, 'speech.wav'), locale: request.locale ?? null,
      durationMs: request.media.source.durationMs }, progress);
    const transcript = DockMediaTranscriptSchema.parse(event.transcript);
    check(context, job);
    await releaseDockMediaJob(context.scope.sessionId, job.id);
    return { ok: true, value: transcript };
  } catch (error) {
    if (job) await releaseDockMediaJob(context.scope.sessionId, job.id);
    const code = error instanceof DockMediaJobError ? error.code
      : stage === 'helper' ? 'local-helper-unavailable' : stage === 'source' ? 'source-unavailable' : 'recognition-failed';
    const unavailable = ['no-audio-track', 'speech-not-authorized', 'on-device-unavailable', 'local-helper-unavailable'].includes(code);
    logger.warn('Local transcription did not complete', { stage, code,
      ...(error instanceof DockMediaJobError ? { nativeDomain: error.nativeDomain, nativeCode: error.nativeCode } : {}) });
    return { ok: true, value: { status: unavailable ? 'unavailable' : 'failed', revision: 1, words: [], error: code } };
  }
}

export async function analyzeDockMedia(context: DockEvidenceContext, request: DockMediaAnalyzeRequest): Promise<DockNativeResult<DockMediaWaveform>> {
  let job: Job | undefined;
  try {
    const source = request.media.source;
    if (source.kind !== 'recording' || source.audio !== 'available') return { ok: false, error: 'unavailable' };
    const binary = await helper('intent-dock-media-transcribe');
    job = await createJob(context, request.jobId, JSON.stringify(request));
    const file = await copySource(context, job, request.media);
    const event = await run(context, job, binary, { source: file, audio: path.join(job.directory, 'waveform.wav'), locale: null,
      mode: 'waveform', sourceId: source.id, sourceRevision: source.revision, durationMs: source.durationMs }, () => {});
    const waveform = DockMediaWaveformSchema.parse(event.waveform);
    check(context, job);
    if (waveform.sourceId !== source.id || waveform.sourceRevision !== source.revision || waveform.durationMs !== source.durationMs) throw new Error('waveform-source-changed');
    return { ok: true, value: waveform };
  } catch { return { ok: false, error: 'failed' }; }
  finally { if (job) await releaseDockMediaJob(context.scope.sessionId, job.id); }
}

/** An old helper ignores unknown job modes. Check before supplying source bytes,
 * so a metadata-only request can never accidentally start PCM/Speech processing. */
async function requireAudioProbeCapability(binary: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(binary, ['--capability'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('audio-probe-unavailable')); }, 2000);
    timer.unref();
    child.stderr.resume(); child.stdin.on('error', () => {}); child.stdin.end();
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.stdout.on('data', (bytes: Buffer) => {
      output += bytes.toString('utf8');
      if (output.length > 16384) { child.kill('SIGKILL'); reject(new Error('audio-probe-unavailable')); }
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      try {
        const value = JSON.parse(output.trim()) as Record<string, unknown>;
        if (code !== 0 || value.event !== 'capability' || !Array.isArray(value.features) ||
            !value.features.includes('audio-probe')) throw new Error('audio-probe-unavailable');
        resolve();
      } catch (error) { reject(error); }
    });
  });
}
export async function probeDockMediaAudio(context: DockEvidenceContext, request: DockMediaAudioProbeRequest): Promise<DockNativeResult<DockMediaAudioProbe>> {
  let job: Job | undefined;
  try {
    const source = request.media.source;
    if (source.kind !== 'recording') return { ok: false, error: 'unavailable' };
    const binary = await helper('intent-dock-media-transcribe');
    await requireAudioProbeCapability(binary);
    check(context);
    job = await createJob(context, request.jobId, JSON.stringify(request));
    const file = await copySource(context, job, request.media);
    const event = await run(context, job, binary, { source: file, audio: '', mode: 'audio-probe',
      sourceId: source.id, sourceRevision: source.revision, durationMs: source.durationMs }, () => {}, 5000);
    const value = DockMediaAudioProbeSchema.parse(event.audioProbe);
    check(context, job);
    if (value.sourceId !== source.id || value.sourceRevision !== source.revision) throw new Error('audio-probe-source-changed');
    logger.info('Original recording audio track metadata', { sourceId: source.id, sourceRevision: source.revision,
      trackCount: value.trackCount, populatedTrackCount: value.populatedTrackCount });
    return { ok: true, value };
  } catch { return { ok: false, error: 'unavailable' }; }
  finally { if (job) await releaseDockMediaJob(context.scope.sessionId, job.id); }
}
