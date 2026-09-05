import { parseUiComponentMetadata, type UiComponentMetadata } from './component-metadata';
import { accordionMetadata } from './accordion/accordion.meta';
import { askUserQuestionsMetadata } from './ask-user-questions/ask-user-questions.meta';
import { badgeMetadata } from './badge/badge.meta';
import { breadcrumbMetadata } from './breadcrumb/breadcrumb.meta';
import { buttonMetadata } from './button/button.meta';
import { buttonGroupMetadata } from './button-group/button-group.meta';
import { cardMetadata } from './card/card.meta';
import { checkboxMetadata } from './checkbox/checkbox.meta';
import { checkboxGroupMetadata } from './checkbox-group/checkbox-group.meta';
import { comboboxMetadata } from './combobox/combobox.meta';
import { copyInputMetadata } from './copy-input/copy-input.meta';
import { dialogMetadata } from './dialog/dialog.meta';
import { dropdownMetadata } from './dropdown/dropdown.meta';
import { fileInputMetadata } from './file-input/file-input.meta';
import { groupedComboboxMetadata } from './grouped-combobox/grouped-combobox.meta';
import { spinnerMetadata } from './indicators/spinner.meta';
import { inputMetadata } from './input/input.meta';
import { inputGroupMetadata } from './input-group/input-group.meta';
import { inputMessageMetadata } from './input-message/input-message.meta';
import { kbdMetadata } from './kbd/kbd.meta';
import { labelMetadata } from './label/label.meta';
import { listMetadata } from './list/list.meta';
import { menuMetadata } from './menu/menu.meta';
import { messageComposerMetadata } from './message-composer/message-composer.meta';
import { proximityHighlightMetadata } from './proximity-highlight/proximity-highlight.meta';
import { radioGroupMetadata } from './radio-group/radio-group.meta';
import { scrollAreaMetadata } from './scroll-area/scroll-area.meta';
import { searchableSelectMetadata } from './searchable-select/searchable-select.meta';
import { selectMetadata } from './select/select.meta';
import { separatorMetadata } from './separator/separator.meta';
import { settingsFieldRowMetadata } from '../patterns/settings/settings-field-row.meta';
import { settingsPageShellMetadata } from './settings-page-shell/settings-page-shell.meta';
import { settingsSectionMetadata } from '../patterns/settings/settings-section.meta';
import { sheetMetadata } from './sheet/sheet.meta';
import { sidebarMetadata } from './sidebar/sidebar.meta';
import { skeletonMetadata } from './skeleton/skeleton.meta';
import { sliderMetadata } from './slider/slider.meta';
import { switchMetadata } from './switch/switch.meta';
import { tableMetadata } from './table/table.meta';
import { tabsMetadata } from './tabs/tabs.meta';
import { textareaMetadata } from './textarea/textarea.meta';
import { toggleMetadata } from './toggle/toggle.meta';
import { toggleGroupMetadata } from './toggle-group/toggle-group.meta';
import { tooltipMetadata } from './tooltip/tooltip.meta';

const sourceMetadata = [
  accordionMetadata,
  askUserQuestionsMetadata,
  badgeMetadata,
  breadcrumbMetadata,
  buttonMetadata,
  buttonGroupMetadata,
  cardMetadata,
  checkboxMetadata,
  checkboxGroupMetadata,
  comboboxMetadata,
  copyInputMetadata,
  dialogMetadata,
  dropdownMetadata,
  fileInputMetadata,
  groupedComboboxMetadata,
  spinnerMetadata,
  inputMetadata,
  inputGroupMetadata,
  inputMessageMetadata,
  kbdMetadata,
  labelMetadata,
  listMetadata,
  menuMetadata,
  messageComposerMetadata,
  proximityHighlightMetadata,
  radioGroupMetadata,
  scrollAreaMetadata,
  searchableSelectMetadata,
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
  tableMetadata,
  tabsMetadata,
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
