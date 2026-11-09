import { nativeImage } from 'electron';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chooseDockFrameEncoding, dockBase64Bytes, dockFrameSize } from '../../../shared/dock-media-frame-budget';
import { Logger } from '../../../shared/logger';

const logger = new Logger('DockMediaOutput');

/**
 * Each model frame goes to the agent as a prompt image, and the daemon refuses a prompt
 * whose images exceed its budget. Re-encode every frame (bounded long edge, JPEG) at the
 * first step where all of them fit; one frame is decoded at a time. The video is untouched.
 */
export async function fitDockMediaFrames(paths: string[], directory: string): Promise<string[]> {
  const chosen = chooseDockFrameEncoding((step) => {
    const frames = paths.map((file) => {
      const image = nativeImage.createFromPath(file);
      if (image.isEmpty()) throw new Error('media-frame-unreadable');
      const { width, height } = image.getSize();
      const size = dockFrameSize(width, height, step.maxEdge);
      return (size.width === width && size.height === height ? image : image.resize({ ...size, quality: 'best' })).toJPEG(step.quality);
    });
    return { frames, bytes: frames.map((frame) => frame.length) };
  });
  const out: string[] = [];
  for (let index = 0; index < chosen.frames.length; index++) {
    const target = path.join(directory, `frame-${index}.jpg`);
    await writeFile(target, chosen.frames[index], { flag: 'wx', mode: 0o600 });
    out.push(target);
  }
  logger.info('Fitted recording frames to the prompt image budget', { frames: out.length, maxEdge: chosen.step.maxEdge,
    quality: chosen.step.quality, base64Bytes: chosen.bytes.reduce((sum, size) => sum + dockBase64Bytes(size), 0), fits: chosen.fits });
  return out;
}
