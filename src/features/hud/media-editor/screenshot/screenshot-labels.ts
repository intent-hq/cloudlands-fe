import { m } from '$shared/paraglide/messages.js';
export function screenshotKindLabel(kind: string): string {
  switch (kind) {
    case 'pointer':
      return m.dock_recordingToolbar_pointer_label();
    case 'element':
      return m.dock_recordingToolbar_element_label();
    case 'box':
      return m.dock_composer_box_label();
    case 'draw':
      return m.dock_recordingToolbar_draw_label();
    case 'arrow':
      return m.dock_recordingToolbar_arrow_label();
    case 'text':
      return m.dock_screenshotEditor_text();
    case 'blur':
      return m.dock_screenshotEditor_blur();
    case 'crop':
      return m.dock_screenshotEditor_crop();
    default:
      return m.dock_screenshotEditor_click();
  }
}
