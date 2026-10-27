import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { app } from 'electron';
import type { Display } from 'electron';
import { z } from 'zod';
import type { DockDisplayGeometry } from '../shared/dock-placement';
import { Logger } from '../shared/logger';

const logger = new Logger('DockDisplayGeometry');
const execute = promisify(execFile);
const NativeGeometrySchema = z
  .array(
    z.object({
      id: z.number().int(),
      cutout: z
        .object({
          x: z.number().finite().nonnegative(),
          y: z.literal(0),
          width: z.number().finite().positive(),
          height: z.number().finite().positive(),
        })
        .nullish(),
    }),
  )
  .max(64);

export async function readDockDisplayGeometry(
  displays: readonly Display[],
): Promise<DockDisplayGeometry[]> {
  const result = displays.map(
    ({ id, bounds, workArea }) => ({ id, bounds, workArea, cutout: null }) as DockDisplayGeometry,
  );
  if (process.platform !== 'darwin') return result;
  // dev-electron launches dist/main/index.js, so its appPath is two levels below
  // the staging resources. electron . and isolated fixtures use the root directly.
  const roots = app.isPackaged
    ? [process.resourcesPath]
    : [
        path.resolve(app.getAppPath(), '..', '..', 'resources'),
        path.join(app.getAppPath(), 'resources'),
      ];
  try {
    let binary: string | undefined;
    for (const root of roots) {
      const candidate = path.join(root, 'dock-helper', 'intent-dock-helper');
      try {
        await access(candidate);
        binary = candidate;
        break;
      } catch {
        // Not built at this launch layout; try the other supported layout.
      }
    }
    if (!binary) return result;
    const { stdout } = await execute(binary, [], { timeout: 2000, maxBuffer: 64 * 1024 });
    const native = NativeGeometrySchema.parse(JSON.parse(stdout));
    for (const display of result) {
      const cutout = native.find((entry) => entry.id === display.id)?.cutout;
      if (!cutout || cutout.x + cutout.width > display.bounds.width || cutout.height > 100)
        continue;
      display.cutout = { ...cutout, x: display.bounds.x + cutout.x, y: display.bounds.y };
    }
  } catch (error) {
    logger.debug('Physical notch geometry unavailable; using top-center fallback', { error });
  }
  return result;
}
