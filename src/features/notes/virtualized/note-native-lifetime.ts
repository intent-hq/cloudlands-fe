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
  private construction?: Promise<void>;

  /** A local history command must not accumulate asynchronous retired views. */
  get idle(): boolean {
    return !this.closed && !this.failure && !this.construction && this.pending.size === 0;
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
    if (this.closed || this.failure) throw new Error('Cannot construct a retired note view');
    return this.own(view);
  }
  /** Internal ownership also accepts a returned product after reentrant retirement. */
  private own<T extends NodeView>(view: T): T {
    this.views.add(view);
    try {
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
    } catch (error) {
      // Wrapper installation is executable ownership work too. A frozen product
      // may reject it; retain failed debt and observe its original cleanup.
      this.failure ??= { error };
      this.views.delete(view);
      try {
        this.observe(view.destroy?.());
      } catch (cleanupError) {
        this.failure ??= { error: cleanupError };
      }
      throw error;
    }
  }

  private construct<T extends NodeView>(factory: () => T): T {
    if (this.closed || this.failure || this.construction)
      throw new Error('Cannot construct a retired note view');
    let finish!: () => void;
    // Publish the receipt before factory callbacks can reenter disposal.
    this.construction = new Promise<void>((resolve) => {
      finish = resolve;
    });
    try {
      let product: T;
      try {
        product = factory();
      } catch (error) {
        // No returned product proves cleanup of a partially constructed factory.
        this.failure ??= { error };
        throw error;
      }
      const owned = this.own(product);
      if (this.closed || this.failure) {
        owned.destroy?.();
        throw new Error('Cannot construct a retired note view');
      }
      return owned;
    } finally {
      this.construction = undefined;
      finish();
    }
  }
  /** Captures this exact lifetime; a closed wrapper never routes to a successor. */
  wrapFactory<A, T extends NodeView>(factory: (args: A) => T): (args: A) => T {
    return (args) => this.construct(() => factory(args));
  }
  extensions(extensions: Extensions): Extensions {
    // Flatten once, then suppress each copied extension's re-expansion. Nested
    // native factories receive the same lifecycle as top-level factories.
    return flattenExtensions(extensions).map((extension) => {
      const copy = extension.extend({ addExtensions: () => [] });
      if (copy.type !== 'node') return copy;
      const construct = this.construct.bind(this);
      return (copy as Node).extend({
        addNodeView() {
          const factory = this.parent?.();
          return factory ? (props) => construct(() => factory(props)) : null;
        },
      });
    });
  }
  dispose(destroy: () => void, release: () => void): Promise<void> {
    if (this.completion) return this.completion;
    this.closed = true;
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    // External destroy/release callbacks must observe this exact cached completion.
    this.completion = new Promise<void>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    void (async () => {
      try {
        destroy();
      } catch (error) {
        this.failure ??= { error };
      }
      // A factory can retire its lifetime before returning its actual product.
      // Its receipt must settle before collecting views or pending cleanup.
      if (this.construction) await this.construction;
      // Also owns successfully constructed factories from a partially failed mount.
      for (const view of this.views) view.destroy?.();
      while (this.pending.size) await Promise.all(this.pending);
      if (this.failure) throw this.failure.error;
      release();
    })().then(resolve, reject);
    return this.completion;
  }
}
