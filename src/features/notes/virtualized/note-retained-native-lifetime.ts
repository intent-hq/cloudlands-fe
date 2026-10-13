import { flattenExtensions, type Editor, type Extensions, type Node } from '@tiptap/core';
import type { EditorView } from '@tiptap/pm/view';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { NoteNativeLifetime } from './note-native-lifetime';

type Ticket = {
  editor: Editor;
  lifetime: NoteNativeLifetime;
  view?: EditorView;
  open: boolean;
};

/** The copied extension graph retains this router, never a replaceable tracker. */
export class NoteRetainedNativeLifetime {
  private ticket?: Ticket;
  private mounting?: Ticket;
  private creating = false;
  private failed = false;
  private dispatching?: {
    ticket: Ticket;
    view: EditorView;
    transaction: Transaction;
    before: EditorState;
  };

  begin(editor: Editor, lifetime: NoteNativeLifetime): Ticket {
    if (this.failed || this.mounting || this.ticket?.open)
      throw new Error('Retained native mount is not admitted');
    const ticket: Ticket = { editor, lifetime, open: true };
    this.ticket = ticket;
    return ticket;
  }
  mount(ticket: Ticket, element: HTMLElement) {
    this.assert(ticket);
    if (this.mounting) throw new Error('Retained native mount is reentrant');
    this.mounting = ticket;
    try {
      ticket.editor.mount(element);
      this.assert(ticket);
      const actual = ticket.editor.view;
      if (ticket.view && ticket.view !== actual) throw new Error('Retained native view mismatch');
      // Even a zero-NodeView plain mount fixes the one permissible view now.
      ticket.view = actual;
    } catch (error) {
      this.failed = true;
      ticket.open = false;
      throw error;
    } finally {
      this.mounting = undefined;
    }
  }
  assert(ticket: Ticket, view?: EditorView) {
    if (this.failed || this.ticket !== ticket || !ticket.open || (view && ticket.view !== view))
      throw new Error('Retained native binding is closed');
  }
  close(ticket: Ticket) {
    ticket.open = false;
  }
  dispatch<T>(ticket: Ticket, view: EditorView, transaction: Transaction, body: () => T): T {
    this.assert(ticket, view);
    if (this.dispatching) throw new Error('Retained dispatch is reentrant');
    this.dispatching = { ticket, view, transaction, before: view.state };
    try {
      return body();
    } finally {
      this.dispatching = undefined;
    }
  }
  admitted(ticket: Ticket): boolean {
    const frame = this.dispatching;
    return (
      !!frame &&
      frame.ticket === ticket &&
      frame.view === ticket.view &&
      ticket.open &&
      !this.failed &&
      this.ticket === ticket &&
      ticket.lifetime.idle &&
      frame.transaction.before === frame.before.doc
    );
  }
  filter(transaction: Transaction, before: EditorState): boolean {
    const frame = this.dispatching;
    return (
      !!frame &&
      frame.transaction === transaction &&
      frame.before === before &&
      this.admitted(frame.ticket)
    );
  }
  extensions(extensions: Extensions): Extensions {
    // TipTap binds extension callback this separately from the retained router.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const router = this;
    return flattenExtensions(extensions).map((extension) => {
      const copy = extension.extend({ addExtensions: () => [] });
      if (copy.type !== 'node') return copy;
      return (copy as Node).extend({
        addNodeView() {
          const ticket = router.mounting;
          if (!ticket || router.creating || this.editor !== ticket.editor)
            throw new Error('Retained native factory creation is not admitted');
          router.assert(ticket);
          router.creating = true;
          try {
            const factory = this.parent?.();
            router.assert(ticket);
            if (!factory) return null;
            const construct = ticket.lifetime.wrapFactory(factory);
            return (props) => {
              router.assert(ticket);
              if (props.editor !== ticket.editor || (ticket.view && props.view !== ticket.view))
                throw new Error('Retained native factory view mismatch');
              if (!ticket.view) {
                if (router.mounting !== ticket) throw new Error('Missing actual mount frame');
                ticket.view = props.view;
              }
              return construct(props);
            };
          } catch (error) {
            router.failed = true;
            ticket.open = false;
            throw error;
          } finally {
            router.creating = false;
          }
        },
      });
    });
  }
}
