import { m } from '$shared/paraglide/messages.js';

/** Forge step heading and copy; the step is optional for everyone. */
export function onboardingForgeCopy(): {
  title: string;
  before: string;
  after: string;
} {
  return {
    title: m.onboarding_page_connectForge_title(),
    before: m.onboarding_page_connectForge_before(),
    after: m.onboarding_page_connectForge_after(),
  };
}
