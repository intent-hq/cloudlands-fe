import type { NoticeDisplayNameReads } from '$lib/components/chat/model-change-notice-core';
import { selectModelDisplayName } from '@/store/model/model-selectors';
import { selectProviderDisplayName } from '@/store/provider-catalog/provider-catalog-selectors';

/** Called during a tracked render; selectors read the existing store without acquiring catalogs. */
export const noticeDisplayNameReads: NoticeDisplayNameReads = {
  providerDisplayName: (providerId) => selectProviderDisplayName(providerId).value,
  modelDisplayName: (providerId, modelId, workspaceId) =>
    selectModelDisplayName(providerId, modelId, workspaceId).value,
};
