/**
 * The Intent OS state file (spec 3.5, `docs/protocol/methods/apps.md` → "Window
 * identity and open entry"): `$XDG_STATE_HOME/intent/apps.json`, which the top
 * bar reads so it needs no daemon credentials. Written atomically (temp file,
 * then rename) after each library change, listing approved apps sorted like
 * `app.list`:
 *
 *   { "version": 1, "apps": [{ "id", "name", "icon": "<absolute PNG path>" | null, "windowTitle" }] }
 *
 * Icons are copied out of the bundle (through `app.readBundle`) into
 * `$XDG_STATE_HOME/intent/app-icons/<appId>.png`, because the bar has no daemon
 * access and the library directory is the daemon's.
 */
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  intentAppWindowTitle,
  isIntentAppOpenable,
  type IntentApp,
} from '../../../shared/intent-apps/intent-apps-types';

export interface AppsStateFileEntry {
  id: string;
  name: string;
  icon: string | null;
  windowTitle: string;
}

export interface AppsStateFile {
  version: 1;
  apps: AppsStateFileEntry[];
}

type Env = Readonly<Record<string, string | undefined>>;

/** `$XDG_STATE_HOME/intent`, with the XDG default `~/.local/state/intent`. */
export function intentStateDir(env: Env = process.env, home = os.homedir()): string {
  const base = env.XDG_STATE_HOME?.trim();
  return path.join(base && path.isAbsolute(base) ? base : path.join(home, '.local', 'state'), 'intent');
}

/** The file's document for `apps` (already sorted like `app.list`). */
export function buildAppsStateFile(
  apps: readonly IntentApp[],
  iconPathFor: (app: IntentApp) => string | null,
): AppsStateFile {
  return {
    version: 1,
    apps: apps.filter(isIntentAppOpenable).map((app) => ({
      id: app.id,
      name: app.name,
      icon: iconPathFor(app),
      windowTitle: intentAppWindowTitle(app.name),
    })),
  };
}

export type ReadIcon = (app: IntentApp) => Promise<Buffer | null>;

async function writeAtomic(target: string, content: string | Buffer): Promise<void> {
  const dir = path.dirname(target);
  await fs.mkdir(dir, { recursive: true });
  const temp = path.join(dir, `.${path.basename(target)}.${process.pid}.${Date.now()}.tmp`);
  try {
    await fs.writeFile(temp, content);
    await fs.rename(temp, target);
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}

/** PNG files start with these 8 bytes; anything else is not written as an icon. */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Writes the state file and the icons of approved apps, and deletes icons of
 * apps that left the list. Calls are serialized; each writes the latest list.
 */
export class AppsStateFileWriter {
  private chain: Promise<void> = Promise.resolve();
  /** Icon files written for (appId, bundleHash), so an unchanged icon is not re-read. */
  private readonly written = new Map<string, string>();

  constructor(
    private readonly dir: string,
    private readonly readIcon: ReadIcon,
  ) {}

  get filePath(): string {
    return path.join(this.dir, 'apps.json');
  }

  private iconPath(appId: string): string {
    return path.join(this.dir, 'app-icons', `${appId}.png`);
  }

  write(apps: readonly IntentApp[]): Promise<void> {
    const run = this.chain.then(() => this.writeNow(apps));
    this.chain = run.catch(() => {});
    return run;
  }

  private async writeNow(apps: readonly IntentApp[]): Promise<void> {
    const listed = apps.filter(isIntentAppOpenable);
    const icons = new Map<string, string>();
    for (const app of listed) {
      if (!app.icon) continue;
      const target = this.iconPath(app.id);
      if (this.written.get(app.id) === app.bundleHash) {
        icons.set(app.id, target);
        continue;
      }
      try {
        const bytes = await this.readIcon(app);
        if (!bytes || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) continue;
        await writeAtomic(target, bytes);
        this.written.set(app.id, app.bundleHash);
        icons.set(app.id, target);
      } catch {
        // No icon: the bar shows a letter tile.
      }
    }
    const document = buildAppsStateFile(listed, (app) => icons.get(app.id) ?? null);
    await writeAtomic(this.filePath, `${JSON.stringify(document, null, 2)}\n`);
    for (const appId of [...this.written.keys()]) {
      if (!icons.has(appId)) this.written.delete(appId);
    }
    // Also icons an earlier run wrote for apps that are gone now.
    const iconDir = path.join(this.dir, 'app-icons');
    const names = await fs.readdir(iconDir).catch(() => [] as string[]);
    for (const name of names) {
      if (name.endsWith('.png') && !icons.has(name.slice(0, -4))) {
        await fs.rm(path.join(iconDir, name), { force: true }).catch(() => {});
      }
    }
  }
}
