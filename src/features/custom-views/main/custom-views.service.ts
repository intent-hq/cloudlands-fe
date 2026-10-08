import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import {
  customViewIdSchema,
  customViewInputSchema,
  savedCustomViewsSchema,
} from '../../../shared/custom-views-schema';
import type {
  CustomView,
  CustomViewErrorCode,
  CustomViewRuntime,
  CustomViewsResponse,
} from '../../../shared/types/custom-views';
import {
  isCustomViewPortAvailable,
  probeCustomView,
  spawnCustomView,
  stopCustomViewProcess,
} from './custom-view-process';

const LOG_LIMIT = 16_384;
class ViewError extends Error {
  constructor(
    readonly code: CustomViewErrorCode,
    message: string,
  ) {
    super(message);
  }
}

interface OwnedProcess {
  child: ChildProcess;
  abort: AbortController;
  stopping?: Promise<void>;
}

interface ServiceOptions {
  spawn?: typeof spawnCustomView;
  stop?: typeof stopCustomViewProcess;
  portAvailable?: typeof isCustomViewPortAvailable;
  probe?: typeof probeCustomView;
  startupTimeoutMs?: number;
  pollIntervalMs?: number;
}

/** Desktop-local registrations; only the process handles in this instance are owned. */
export class CustomViewsService {
  private views: CustomView[] = [];
  private loaded = false;
  private readonly runtimes = new Map<string, CustomViewRuntime>();
  private readonly processes = new Map<string, OwnedProcess>();
  private chain: Promise<unknown> = Promise.resolve();
  private disposed = false;
  private disposal?: Promise<void>;

  constructor(
    private readonly file: string,
    private readonly options: ServiceOptions = {},
  ) {}

  private enqueue<T>(run: () => Promise<T>): Promise<T> {
    const result = this.chain.then(run);
    this.chain = result.catch(() => {});
    return result;
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const info = await fs.stat(this.file);
      if (info.size > 1_048_576) throw new Error('Registrations file is too large');
      this.views = savedCustomViewsSchema.parse(JSON.parse(await fs.readFile(this.file, 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') this.views = [];
      else throw new ViewError('storage-failed', 'Could not read custom view registrations.');
    }
    for (const view of this.views)
      this.runtimes.set(view.id, { id: view.id, status: 'stopped', logs: '' });
    this.loaded = true;
  }

  private async persist(views: CustomView[]): Promise<void> {
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const handle = await fs.open(temporary, 'wx', 0o600);
      try {
        await handle.writeFile(JSON.stringify(views, null, 2), 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.rename(temporary, this.file);
    } catch {
      await fs.rm(temporary, { force: true }).catch(() => {});
      throw new ViewError('storage-failed', 'Could not save custom view registrations.');
    }
  }

  private response(): CustomViewsResponse {
    return {
      success: true,
      data: {
        views: this.views.map((view) => ({ ...view })),
        runtimes: this.views.map((view) => ({ ...this.runtime(view.id) })),
      },
    };
  }

  private request(run: () => Promise<void>): Promise<CustomViewsResponse> {
    return this.enqueue(async () => {
      try {
        if (this.disposed) throw new ViewError('start-failed', 'Custom views are shutting down.');
        await this.load();
        await run();
        return this.response();
      } catch (error) {
        return {
          success: false,
          error: {
            code: error instanceof ViewError ? error.code : 'invalid-input',
            message: error instanceof ViewError ? error.message : 'Invalid custom view request.',
          },
        };
      }
    });
  }

  list(): Promise<CustomViewsResponse> {
    return this.request(async () => {});
  }

  save(input: unknown): Promise<CustomViewsResponse> {
    return this.request(async () => {
      const parsed = customViewInputSchema.parse(input);
      const existing = parsed.id ? this.find(parsed.id) : undefined;
      await this.checkDirectory(parsed.directory);
      if (this.views.some((view) => view.id !== parsed.id && view.port === parsed.port)) {
        throw new ViewError('port-in-use', 'Another custom view is registered on this port.');
      }
      if (!existing && this.views.length >= 100)
        throw new ViewError('invalid-input', 'Too many custom views.');
      const view: CustomView = { ...parsed, id: parsed.id ?? randomUUID() };
      const next = existing
        ? this.views.map((item) => (item.id === view.id ? view : item))
        : [...this.views, view];
      if (existing) await this.stopOwned(view.id);
      await this.persist(next);
      this.views = next;
      this.runtimes.set(view.id, { id: view.id, status: 'stopped', logs: '' });
    });
  }

  remove(input: unknown): Promise<CustomViewsResponse> {
    return this.request(async () => {
      const view = this.find(customViewIdSchema.parse(input).id);
      const next = this.views.filter((item) => item.id !== view.id);
      await this.stopOwned(view.id);
      await this.persist(next);
      this.views = next;
      this.runtimes.delete(view.id);
    });
  }

  start(input: unknown): Promise<CustomViewsResponse> {
    return this.request(async () => {
      const view = this.find(customViewIdSchema.parse(input).id);
      const previous = this.processes.get(view.id);
      if (previous?.abort.signal.aborted) await this.stopOwned(view.id);
      else if (previous) return;
      const runtime: CustomViewRuntime = { id: view.id, status: 'starting', logs: '' };
      this.runtimes.set(view.id, runtime);
      try {
        await this.checkDirectory(view.directory);
        if (!(await (this.options.portAvailable ?? isCustomViewPortAvailable)(view.port))) {
          throw new ViewError('port-in-use', 'The selected port is already in use.');
        }
        if (this.disposed) throw new ViewError('start-failed', 'Custom views are shutting down.');
        const child = (this.options.spawn ?? spawnCustomView)(view);
        const owned: OwnedProcess = { child, abort: new AbortController() };
        this.processes.set(view.id, owned);
        for (const stream of [child.stdout, child.stderr]) {
          stream?.setEncoding('utf8');
          stream?.on('data', (chunk: string) => {
            runtime.logs = (runtime.logs + chunk).slice(-LOG_LIMIT);
          });
        }
        child.once('error', (error) => {
          runtime.logs = (runtime.logs + error.message).slice(-LOG_LIMIT);
          this.fail(view.id, owned, 'start-failed');
        });
        child.once('exit', (code, signal) => {
          if (owned.abort.signal.aborted) return;
          runtime.logs = (runtime.logs + `\nServer exited (${signal ?? code ?? 'unknown'}).`).slice(
            -LOG_LIMIT,
          );
          this.fail(view.id, owned, 'server-exited');
        });
        void this.waitForReady(view, owned);
      } catch (error) {
        runtime.status = 'error';
        runtime.errorCode = error instanceof ViewError ? error.code : 'start-failed';
      }
    });
  }

  stop(input: unknown): Promise<CustomViewsResponse> {
    return this.request(async () => {
      const view = this.find(customViewIdSchema.parse(input).id);
      await this.stopOwned(view.id);
      const runtime = this.runtime(view.id);
      runtime.status = 'stopped';
      delete runtime.url;
      delete runtime.errorCode;
    });
  }

  private find(id: string): CustomView {
    const view = this.views.find((item) => item.id === id);
    if (!view) throw new ViewError('not-found', 'Custom view no longer exists.');
    return view;
  }

  private runtime(id: string): CustomViewRuntime {
    const runtime = this.runtimes.get(id);
    if (!runtime) throw new ViewError('not-found', 'Custom view no longer exists.');
    return runtime;
  }

  private async checkDirectory(directory: string): Promise<void> {
    if (!path.isAbsolute(directory))
      throw new ViewError('invalid-input', 'Choose an absolute server directory.');
    try {
      if ((await fs.stat(directory)).isDirectory()) return;
    } catch {
      /* Report below. */
    }
    throw new ViewError('directory-unavailable', 'The server directory is unavailable.');
  }

  private async waitForReady(view: CustomView, owned: OwnedProcess): Promise<void> {
    const signal = owned.abort.signal;
    const deadline = Date.now() + (this.options.startupTimeoutMs ?? 30_000);
    const url = `http://127.0.0.1:${view.port}/`;
    try {
      while (!signal.aborted && Date.now() < deadline) {
        const ready = await (this.options.probe ?? probeCustomView)(url, signal);
        if (signal.aborted) return;
        if (ready) {
          const runtime = this.runtime(view.id);
          runtime.status = 'running';
          runtime.url = url;
          return;
        }
        await delay(this.options.pollIntervalMs ?? 250, undefined, { signal });
      }
      if (!signal.aborted) this.fail(view.id, owned, 'startup-timeout');
    } catch {
      if (!signal.aborted) this.fail(view.id, owned, 'start-failed');
    }
  }

  private fail(id: string, owned: OwnedProcess, code: CustomViewErrorCode): void {
    if (owned.abort.signal.aborted || this.processes.get(id) !== owned) return;
    const runtime = this.runtime(id);
    runtime.status = 'error';
    runtime.errorCode = code;
    delete runtime.url;
    void this.stopOwned(id).catch(() => {});
  }

  private stopOwned(id: string): Promise<void> {
    const owned = this.processes.get(id);
    if (!owned) return Promise.resolve();
    if (owned.stopping) return owned.stopping;
    owned.abort.abort();
    owned.stopping = (this.options.stop ?? stopCustomViewProcess)(owned.child).then(
      () => {
        if (this.processes.get(id) === owned) this.processes.delete(id);
        const runtime = this.runtimes.get(id);
        if (runtime && runtime.status !== 'error') runtime.status = 'stopped';
        if (runtime) delete runtime.url;
      },
      () => {
        // Keep the handle so stop/quit can retry a failed tree termination.
        delete owned.stopping;
        const runtime = this.runtimes.get(id);
        if (runtime) {
          runtime.status = 'error';
          runtime.errorCode = 'start-failed';
          delete runtime.url;
        }
        throw new ViewError('start-failed', 'Could not stop the custom view server.');
      },
    );
    return owned.stopping;
  }

  dispose(): Promise<void> {
    this.disposed = true;
    this.disposal ??= this.enqueue(async () => {
      const results = await Promise.allSettled(
        [...this.processes.keys()].map((id) => this.stopOwned(id)),
      );
      const failure = results.find((result) => result.status === 'rejected');
      if (failure?.status === 'rejected') throw failure.reason;
    });
    return this.disposal;
  }
}
