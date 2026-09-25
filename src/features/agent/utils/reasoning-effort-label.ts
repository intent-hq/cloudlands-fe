import { m } from '$shared/paraglide/messages.js';

/** Provider labels are translated; newly advertised levels remain readable. */
export function reasoningEffortLabel(effort: string | null): string {
  switch (effort) {
    case null:
      return m.chat_effortPicker_level_auto();
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
