import type { Collection } from '@themislib/themis/utils/collections/collection-utils';
import type {
  CustomView,
  CustomViewErrorCode,
  CustomViewRuntime,
} from '$shared/types/custom-views';

export interface CustomViewsState {
  views: Collection<CustomView, 'id'>;
  runtimes: Collection<CustomViewRuntime, 'id'>;
  loaded: boolean;
  busy: boolean;
  error: CustomViewErrorCode | null;
  errorFromMutation: boolean;
  selectedId: string | null;
  editorOpen: boolean;
  editingId: string | null;
  frame: {
    id: string | null;
    revision: number;
    status: 'idle' | 'loading' | 'loaded' | 'slow' | 'error';
  };
}
