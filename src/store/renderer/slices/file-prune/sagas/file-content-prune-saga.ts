import {
  selectFileContentPrunePayload,
  selectPanelLayoutWorkspaces,
} from '../../panel-layout/panel-layout-selectors';
import { createFileContentPruneSaga } from './file-content-prune-saga-factory';

/** Source compatibility binding preserves immediate cleanup. */
export const fileContentPruneSaga = createFileContentPruneSaga({
  selectFileContentPrunePayload,
  selectPanelLayoutWorkspaces,
});
