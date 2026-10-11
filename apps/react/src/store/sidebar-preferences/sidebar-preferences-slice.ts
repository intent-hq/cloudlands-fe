import { createAction } from '@themislib/themis/utils/store/create-action';

export const persistSidebarOpen = createAction<[open: boolean]>('sidebarPreferences/persistOpen');
