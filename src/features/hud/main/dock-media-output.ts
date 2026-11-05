/** Session-bound offline jobs. No renderer-chosen host paths or backend fallback. */
import { app, nativeImage } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { access, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  defaultDockMediaEdit, planDockMediaOutput, DockMediaTranscriptSchema,
  type DockSavedMedia,
} from '../../../shared/dock-media-edit';
import type { DockMediaExportRequest, DockMediaNativeOutput, DockMediaTranscribeRequest } from '../../../shared/dock-media-output';
import type { DockNativeResult } from '../../../shared/dock-evidence';
import type { DockEvidenceContext } from './dock-evidence-session';
import { requestRouted } from '../../backend/main/transfer-connections';

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
export async function dockMediaOutputReady(source: DockSavedMedia['source'], _saved?: DockSavedMedia['saved']): Promise<{ ready: boolean; reason?: 'legacy-baked-marks' }> {
  if (source.visuals !== 'clean') return { ready: false, reason: 'legacy-baked-marks' };
  if (source.kind === 'screenshot') return { ready: true };
  try { await helper('intent-dock-media-export'); return { ready: true }; }
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
  progress: (fraction: number) => void): Promise<Record<string, unknown>> {
  check(context, job);
  const child = spawn(binary, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  job.child = child;
  let finish!: () => void;
  job.done = new Promise<void>((resolve) => { finish = resolve; });
  let buffer = '', total = 0, completed: Record<string, unknown> | undefined;
  const timeout = setTimeout(() => { job.stopped = true; child.kill('SIGTERM'); }, 5 * 60_000);
  timeout.unref();
  try {
    return await new Promise((resolve, reject) => {
      const fail = () => reject(new Error('media-job-failed'));
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
            if (event.event === 'complete') completed = event;
          } catch { child.kill('SIGTERM'); fail(); }
        }
      });
      child.once('close', (code) => { finish(); code === 0 && completed && !job.stopped && context.isCurrent() ? resolve(completed) : fail(); });
      child.stdin.on('error', fail);
      child.stdin.end(JSON.stringify(input));
    });
  } finally { clearTimeout(timeout); }
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
    const boundaries = [...new Set([0, source.durationMs, ...plan.marks.flatMap((entry) => [entry.frameAtMs, entry.visibleUntilMs])])].sort((a, b) => a - b);
    const spans = boundaries.slice(0, -1).map((atMs, index) => ({ atMs, endMs: boundaries[index + 1] }))
      .filter((span) => plan.marks.some((entry) => span.atMs >= entry.frameAtMs && span.atMs < entry.visibleUntilMs));
    if (request.layers.length !== spans.length || request.layers.reduce((sum, layer) => sum + layer.png.length, 0) > MAX_BYTES) throw new Error('media-layers');
    const binary = await helper('intent-dock-media-export');
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
    const frames = plan.marks.map((entry, index) => ({ path: path.join(job!.directory, `frame-${index}.png`), atMs: Math.min(source.durationMs - 1, entry.frameAtMs) }));
    await run(context, job, binary, { source: file, output, ranges: plan.clips, muted: plan.muted, layers, frames,
      expectedWidth: source.width, expectedHeight: source.height, expectedDurationMs: source.durationMs,
      crop: edit.crop, blurRegions: edit.blurRegions }, progress);
    check(context, job);
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
  try {
    if (request.media.source.audio === 'none') return { ok: true, value: { status: 'no-speech', revision: 1, words: [] } };
    const binary = await helper('intent-dock-media-transcribe');
    job = await createJob(context, request.jobId, JSON.stringify(request));
    const file = await copySource(context, job, request.media);
    const event = await run(context, job, binary, { source: file, audio: path.join(job.directory, 'speech.wav'), locale: request.locale ?? null,
      durationMs: request.media.source.durationMs }, progress);
    const transcript = DockMediaTranscriptSchema.parse(event.transcript);
    check(context, job);
    await releaseDockMediaJob(context.scope.sessionId, job.id);
    return { ok: true, value: transcript };
  } catch {
    if (job) await releaseDockMediaJob(context.scope.sessionId, job.id);
    return { ok: true, value: { status: 'unavailable', revision: 1, words: [], error: 'local-recognition-unavailable' } };
  }
}
