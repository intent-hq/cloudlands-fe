import { m } from '$shared/paraglide/messages.js';

/** Known levels match case-insensitively; unknown provider values retain their spelling. */
export function reasoningEffortLabel(effort: string | null): string {
  if (effort === null) return m.chat_effortPicker_level_auto();
  switch (effort.toLowerCase()) {
    case 'none':
      return m.chat_shared_valueOff_label();
    case 'minimal':
      return m.chat_effortPicker_level_minimal();
    case 'low':
      return m.chat_effortPicker_level_low();
    case 'medium':
      return m.chat_effortPicker_level_medium();
    case 'high':
      return m.chat_effortPicker_level_high();
    case 'xhigh':
      return m.chat_effortPicker_level_xhigh();
    case 'max':
      return m.chat_effortPicker_level_max();
    default:
      return effort;
  }
}
