import type { AuggieModel } from '$features/auggie/auggie-models.client';

export type PromotionalBannerAgentGroup = 'general' | 'specialists';

export interface PromotionalBannerSetDefaultAgentAction {
  type: 'setDefaultAgent';
  agentId: string;
}

export interface PromotionalBannerSetDefaultModelAction {
  type: 'setDefaultModel';
  model: AuggieModel['value'];
  agents: PromotionalBannerAgentGroup[];
}

export type PromotionalBannerAction =
  | PromotionalBannerSetDefaultAgentAction
  | PromotionalBannerSetDefaultModelAction;

export interface PromotionalBannerHideWhenDefaultAgentIs {
  type: 'defaultAgentIs';
  agentId: string;
}

export type PromotionalBannerHideWhen = PromotionalBannerHideWhenDefaultAgentIs;

export interface PromotionalBannerButton {
  text: string;
  action: PromotionalBannerAction;
  hideWhen?: PromotionalBannerHideWhen;
}

export interface PromotionalBanner {
  id: string;
  startAt: string;
  endAt: string;
  priority: number;
  dismissable: boolean;
  message: string;
  buttons: PromotionalBannerButton[];
}

export type PromotionalBannerResponse = PromotionalBanner[];