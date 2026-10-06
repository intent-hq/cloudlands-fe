import { flattenExtensions, type Extensions, type Node } from '@tiptap/core';
import type { NodeView } from '@tiptap/pm/view';
import { SvelteRenderer } from 'svelte-tiptap';
import { unmount } from 'svelte';

/** One editor's actual native lifetimes, including views retired by transactions.
 * SvelteRenderer discards unmount's promise. Wrap only this reader's instances,
 * preserving native node-view cleanup and leaving dependency prototypes untouched.
 * Rejected disposal retains credit: a failed cleanup is not evidence of release. */
export class NoteNativeLifetime {
  private views = new Set<NodeView>();
  private pending = new Set<Promise<void>>();
  private failure?: { error: unknown };
  private closed = false;
  private completion?: Promise<void>;

  /** A local history command must not accumulate asynchronous retired views. */
  get idle(): boolean {
    return !this.closed && !this.failure && this.pending.size === 0;
  }

  private observe(value: unknown) {
    if (!value || typeof (value as PromiseLike<unknown>).then !== 'function') return;
    const pending = Promise.resolve(value).then(
      () => {
        this.pending.delete(pending);
      },
      (error: unknown) => {
        this.failure ??= { error };
        this.pending.delete(pending);
      },
    );
    this.pending.add(pending);
  }
  track<T extends NodeView>(view: T): T {
    if (this.closed) throw new Error('Cannot construct a retired note view');
    this.views.add(view);
    const renderer = (view as NodeView & { renderer?: unknown }).renderer;
    if (renderer instanceof SvelteRenderer) {
      let unmounted = false;
      renderer.destroy = () => {
        if (unmounted) return;
        unmounted = true;
        this.observe(unmount(renderer.component));
      };
    }
    const destroy = view.destroy?.bind(view);
    let destroyed = false;
    view.destroy = () => {
      if (destroyed) return;
      destroyed = true;
      this.views.delete(view);
      try {
        this.observe(destroy?.());
      } catch (error) {
        this.failure ??= { error };
      }
    };
    return view;
  }
  extensions(extensions: Extensions): Extensions {
    // Flatten once, then suppress each copied extension's re-expansion. Nested
    // native factories receive the same lifecycle as top-level factories.
    return flattenExtensions(extensions).map((extension) => {
      const copy = extension.extend({ addExtensions: () => [] });
      if (copy.type !== 'node') return copy;
      const track = this.track.bind(this);
      return (copy as Node).extend({
        addNodeView() {
          const factory = this.parent?.();
          return factory ? (props) => track(factory(props)) : null;
        },
      });
    });
  }
  dispose(destroy: () => void, release: () => void): Promise<void> {
    if (this.completion) return this.completion;
    this.closed = true;
    this.completion = (async () => {
      try {
        destroy();
      } catch (error) {
        this.failure ??= { error };
      }
      // Also owns successfully constructed factories from a partially failed mount.
      for (const view of this.views) view.destroy?.();
      await Promise.all(this.pending);
      if (this.failure) throw this.failure.error;
      release();
    })();
    return this.completion;
  }
}
