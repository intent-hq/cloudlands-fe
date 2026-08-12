import { parseUiComponentMetadata, type UiComponentMetadata } from './component-metadata';
import { badgeMetadata } from './badge/badge.meta';
import { breadcrumbMetadata } from './breadcrumb/breadcrumb.meta';
import { buttonMetadata } from './button/button.meta';
import { buttonGroupMetadata } from './button-group/button-group.meta';
import { cardMetadata } from './card/card.meta';
import { checkboxMetadata } from './checkbox/checkbox.meta';
import { comboboxMetadata } from './combobox/combobox.meta';
import { dialogMetadata } from './dialog/dialog.meta';
import { fileInputMetadata } from './file-input/file-input.meta';
import { spinnerMetadata } from './indicators/spinner.meta';
import { inputMetadata } from './input/input.meta';
import { labelMetadata } from './label/label.meta';
import { listMetadata } from './list/list.meta';
import { menuMetadata } from './menu/menu.meta';
import { scrollAreaMetadata } from './scroll-area/scroll-area.meta';
import { selectMetadata } from './select/select.meta';
import { separatorMetadata } from './separator/separator.meta';
import { settingsFieldRowMetadata } from './settings-field-row/settings-field-row.meta';
import { settingsPageShellMetadata } from './settings-page-shell/settings-page-shell.meta';
import { settingsSectionMetadata } from './settings-section/settings-section.meta';
import { sheetMetadata } from './sheet/sheet.meta';
import { sidebarMetadata } from './sidebar/sidebar.meta';
import { skeletonMetadata } from './skeleton/skeleton.meta';
import { sliderMetadata } from './slider/slider.meta';
import { switchMetadata } from './switch/switch.meta';
import { textareaMetadata } from './textarea/textarea.meta';
import { toggleMetadata } from './toggle/toggle.meta';
import { toggleGroupMetadata } from './toggle-group/toggle-group.meta';
import { tooltipMetadata } from './tooltip/tooltip.meta';

const sourceMetadata = [
  badgeMetadata,
  breadcrumbMetadata,
  buttonMetadata,
  buttonGroupMetadata,
  cardMetadata,
  checkboxMetadata,
  comboboxMetadata,
  dialogMetadata,
  fileInputMetadata,
  spinnerMetadata,
  inputMetadata,
  labelMetadata,
  listMetadata,
  menuMetadata,
  scrollAreaMetadata,
  selectMetadata,
  separatorMetadata,
  settingsFieldRowMetadata,
  settingsPageShellMetadata,
  settingsSectionMetadata,
  sheetMetadata,
  sidebarMetadata,
  skeletonMetadata,
  sliderMetadata,
  switchMetadata,
  textareaMetadata,
  toggleMetadata,
  toggleGroupMetadata,
  tooltipMetadata,
];

export const canonicalComponentManifest: readonly UiComponentMetadata[] = sourceMetadata
  .map((metadata) => parseUiComponentMetadata(metadata))
  .sort((left, right) =>
    left.publicImport < right.publicImport ? -1 : left.publicImport > right.publicImport ? 1 : 0,
  );
