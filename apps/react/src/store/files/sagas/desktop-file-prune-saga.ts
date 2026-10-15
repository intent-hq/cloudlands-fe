import { createFileContentPruneSaga } from '../../../../../../src/store/renderer/slices/file-prune/sagas/file-content-prune-saga-factory';
import {
  selectDesktopFilePrunePayload,
  selectDesktopFilePanelLayouts,
  selectDesktopFileSaveOperation,
  selectDesktopFileCanPrune,
} from '../desktop-file-selectors';

/** Dirty/unknown text survives view retirement; only settled, unreferenced cache entries leave. */
export const desktopFilePruneSaga = createFileContentPruneSaga({
  selectFileContentPrunePayload: selectDesktopFilePrunePayload,
  selectPanelLayoutWorkspaces: selectDesktopFilePanelLayouts,
  retainUnsettled: {
    selectSaveOperation: selectDesktopFileSaveOperation,
    selectCanPrune: selectDesktopFileCanPrune,
  },
});
