import { Button } from '@/components/ui/button';
import { m } from '$shared/paraglide/messages.js';
import './toast-undo-action.css';

export function ToastUndoAction({ onClick }: { onClick?: () => void }) {
  return (
    <Button variant="outline" size="compact" className="toast-undo-action" onClick={onClick}>
      <span>{m.ui_reversibleActions_undo_label()}</span>
      {/* i18n-ignore (keyboard shortcut glyph) */}
      <kbd data-toast-shortcut>⌘Z</kbd>
    </Button>
  );
}
