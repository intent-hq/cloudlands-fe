import { Button } from '@/components/ui/button';
import { IconDefinitionIcon } from '@/components/icons/icon-definition';
import { faCheck, faXmark } from '$lib/icons/phosphor-icon-definitions';
import { m } from '$shared/paraglide/messages.js';

interface SuggestionTooltipProps {
  suggestion: {
    id: string;
    type: 'addition' | 'deletion' | 'modification';
    author?: string;
    reason?: string;
    originalText?: string;
  };
  x?: number;
  y?: number;
  onAccept?: (id: string) => void;
  onReject?: (id: string) => void;
}

function getTypeLabel(type: string) {
  switch (type) {
    case 'addition':
      return m.tiptap_suggestionTooltip_addition_label();
    case 'deletion':
      return m.tiptap_suggestionTooltip_deletion_label();
    case 'modification':
      return m.tiptap_suggestionTooltip_modification_label();
    default:
      return m.tiptap_suggestionTooltip_suggestion_label();
  }
}

export function SuggestionTooltip({
  suggestion,
  x = 0,
  y = 0,
  onAccept,
  onReject,
}: SuggestionTooltipProps) {
  return (
    <div className="suggestion-tooltip" style={{ left: x, top: y }}>
      <div className="flex justify-between items-center mb-2">
        <span className="font-semibold text-xs">{getTypeLabel(suggestion.type)}</span>
        {suggestion.author && (
          <span className="suggestion-tooltip-author">
            {m.tiptap_suggestionTooltip_byAuthor_label({ author: suggestion.author })}
          </span>
        )}
      </div>
      {suggestion.reason && <div className="suggestion-tooltip-reason">{suggestion.reason}</div>}
      {suggestion.originalText && suggestion.type === 'modification' && (
        <div className="mt-2 py-1 px-2 bg-muted rounded text-xs">
          <span className="font-semibold mr-1">{m.tiptap_suggestionTooltip_original_label()}</span>{' '}
          <span className="italic">{suggestion.originalText}</span>
        </div>
      )}
      <div className="suggestion-tooltip-actions">
        <Button variant="ghost" className="accept" onClick={() => onAccept?.(suggestion.id)}>
          <IconDefinitionIcon icon={faCheck} size="0.75em" className="inline mr-1" />{' '}
          {m.tiptap_suggestionTooltip_accept_label()}
        </Button>
        <Button variant="ghost" className="reject" onClick={() => onReject?.(suggestion.id)}>
          <IconDefinitionIcon icon={faXmark} size="0.75em" className="inline mr-1" />{' '}
          {m.tiptap_suggestionTooltip_reject_label()}
        </Button>
      </div>
    </div>
  );
}
