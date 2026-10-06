import type { Editor, EditorOptions } from '@tiptap/core';
import type { EditorView } from '@tiptap/pm/view';

type Port = NonNullable<EditorOptions['deferredTasks']>;
type Scope = ReturnType<Port['beginMount']>;
type Kind = Parameters<Scope['enqueue']>[0];
type Epoch = {
  scope: Scope;
  reusable(): boolean;
  bind(view: EditorView): void;
  unbind(view: EditorView): void;
  matches(view: EditorView): boolean;
};
type Task = {
  body: (() => void) | null;
  kind: Kind;
  handle: number | null;
  state: 'allocating' | 'queued' | 'canceling' | 'cancel-failed' | 'running' | 'done';
};

const TASK_LIMIT = 32;
const FRAME_LIMIT = 8;

/** Owns only the named synchronous callbacks and their browser scheduling handles. */
export function createEditorDeferredTasks() {
  const timeout = window.setTimeout.bind(window);
  const clearTimeout = window.clearTimeout.bind(window);
  const frame = window.requestAnimationFrame.bind(window);
  const cancelFrame = window.cancelAnimationFrame.bind(window);
  let editor: Editor | null = null;
  let retired = false;
  let epoch: Epoch | null = null;
  const frames: Scope[] = [];

  function createEpoch(): Epoch {
    let view: EditorView | null = null;
    let closed = false;
    let cleanupClaimed = false;
    let detached = false;
    let bound = false;
    let failure: Error | null = null;
    let depth = 0;
    let drained = false;
    const tasks = new Set<Task>();
    let idle: { promise: Promise<void>; resolve(): void; reject(error: Error): void } | null = null;
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const settled = new Promise<void>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    // The owner observes failure even when no consumer awaits this terminal receipt.
    void settled.catch(() => undefined);

    function finish() {
      if (tasks.size || depth) return;
      if (idle) {
        const waiter = idle;
        idle = null;
        if (failure) waiter.reject(failure);
        else waiter.resolve();
      }
      if (closed && !drained) {
        drained = true;
        if (failure) reject(failure);
        else {
          resolve();
        }
      }
      if (drained && detached && !failure) {
        view = null;
        if (retired) editor = null;
      }
    }
    function cancel(task: Task) {
      if (task.state !== 'queued' || task.handle === null) return;
      task.state = 'canceling';
      try {
        if (task.kind === 'focus-frame' || task.kind === 'update-focus') cancelFrame(task.handle);
        else clearTimeout(task.handle);
        task.state = 'done';
        task.body = null;
        tasks.delete(task);
      } catch (error) {
        task.state = 'cancel-failed';
        failure ??= error instanceof Error ? error : new Error('Editor task cancellation failed');
        // Unknown cancellation outcome retains this task and its physical debt.
      }
    }
    function closeTasks() {
      closed = true;
      for (const task of tasks) cancel(task);
    }
    function fail(error: unknown) {
      failure ??= error instanceof Error ? error : new Error('Editor task failed');
      closeTasks();
      if (idle) {
        idle.reject(failure);
        idle = null;
      }
    }
    function enter<T>(body: () => T, closing = false): T {
      if (!closing) scope.assertOpen();
      if (depth >= FRAME_LIMIT || frames.length >= FRAME_LIMIT) {
        fail(new Error('Editor task frame limit exceeded'));
        finish();
        throw failure;
      }
      depth++;
      frames.push(scope);
      try {
        const result = body();
        if (
          result !== null &&
          (typeof result === 'object' || typeof result === 'function') &&
          'then' in result
        ) {
          throw new Error('Editor task bodies must be synchronous');
        }
        if (!closing) scope.assertOpen();
        return result;
      } catch (error) {
        fail(error);
        throw error;
      } finally {
        frames.pop();
        depth--;
        finish();
      }
    }
    const scope: Scope = Object.freeze({
      run: <T>(body: () => T) => enter(body),
      assertOpen() {
        if (closed || retired || failure || epoch?.scope !== scope) {
          throw new Error('Editor task scope is closed');
        }
      },
      enqueue(kind: Kind, body: () => void) {
        scope.assertOpen();
        if (!view || typeof body !== 'function') throw new Error('Editor task view is not bound');
        if (tasks.size >= TASK_LIMIT) {
          fail(new Error('Editor task limit exceeded'));
          finish();
          throw failure;
        }
        const task: Task = { body, kind, handle: null, state: 'allocating' };
        tasks.add(task);
        const invoke = () => {
          if (task.state === 'allocating') {
            fail(new Error('Editor scheduler invoked synchronously'));
            return;
          }
          if (task.state !== 'queued') return;
          if (closed || retired || failure) {
            cancel(task);
            finish();
            return;
          }
          task.state = 'running';
          try {
            enter(() => task.body?.());
          } catch {
            // enter records the failure; terminal/idle receipts expose it.
          } finally {
            task.body = null;
            task.state = 'done';
            tasks.delete(task);
            finish();
          }
        };
        try {
          task.handle =
            kind === 'focus-frame' || kind === 'update-focus' ? frame(invoke) : timeout(invoke, 0);
          task.state = 'queued';
          if (closed || retired || failure) cancel(task);
          scope.assertOpen();
        } catch (error) {
          fail(error);
          // A registration throw without a returned handle has an unknown outcome.
          throw error;
        } finally {
          finish();
        }
      },
      whenIdle() {
        if (failure) return Promise.reject(failure);
        if (!tasks.size && !depth) return Promise.resolve();
        if (!idle) {
          let resolve!: () => void;
          let reject!: (error: Error) => void;
          const promise = new Promise<void>((yes, no) => {
            resolve = yes;
            reject = no;
          });
          void promise.catch(() => undefined);
          idle = { promise, resolve, reject };
        }
        return idle.promise;
      },
      close(body?: () => void) {
        if (body) {
          if (cleanupClaimed) throw new Error('Editor closing callback was already claimed');
          cleanupClaimed = true;
          // Claim a closing frame BEFORE invoking cancel functions or native destruction.
          enter(() => {
            closeTasks();
            return body();
          }, true);
        } else if (!closed) {
          enter(closeTasks, true);
        }
      },
      settled,
    });
    return {
      scope,
      reusable: () => drained && detached && !failure,
      bind(actual: EditorView) {
        scope.assertOpen();
        if (bound) throw new Error('Editor task view is already bound');
        bound = true;
        view = actual;
      },
      unbind(actual: EditorView) {
        if (!closed || view !== actual || detached || !actual.isDestroyed) {
          throw new Error('Editor task view is not detached');
        }
        detached = true;
        finish();
      },
      matches: (actual: EditorView) => view === actual && !detached,
    };
  }

  const port: Port = Object.freeze({
    beginMount(actual: Editor) {
      if (
        retired ||
        frames.length ||
        (editor && editor !== actual) ||
        (epoch && !epoch.reusable())
      ) {
        throw new Error('Editor task mount is not admitted');
      }
      editor = actual;
      epoch = createEpoch();
      return epoch.scope;
    },
    bindView(scope: Scope, actual: Editor, view: EditorView) {
      if (actual !== editor || scope !== epoch?.scope || actual.view !== view) {
        throw new Error('Editor task view mismatch');
      }
      epoch.bind(view);
    },
    unbindView(scope: Scope, actual: Editor, view: EditorView) {
      if (actual !== editor || scope !== epoch?.scope) throw new Error('Editor task view mismatch');
      epoch.unbind(view);
    },
    capture(actual: Editor, view: EditorView) {
      const active = frames.at(-1);
      if (
        actual !== editor ||
        !epoch ||
        (active && active !== epoch.scope) ||
        !epoch.matches(view)
      ) {
        throw new Error('Editor task capture is not bound');
      }
      epoch.scope.assertOpen();
      return epoch.scope;
    },
  });
  return Object.freeze({
    port,
    retire() {
      retired = true;
      epoch?.scope.close();
      if (!epoch || epoch.reusable()) editor = null;
    },
  });
}
