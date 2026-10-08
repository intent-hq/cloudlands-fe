import { createAction } from '@themislib/themis/utils/store/create-action';

/**
 * Replace one DOM observer's visible-card demand. Pass [] when it unmounts.
 * This is a saga-only resource lease; domain data stays in its existing slices.
 */
export const setDashboardVisibleWorkspaces = createAction<
  [ownerId: string, workspaceIds: string[]]
>('dashboardDetails/setVisibleWorkspaces');
