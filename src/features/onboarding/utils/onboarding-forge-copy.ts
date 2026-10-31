import { m } from '$shared/paraglide/messages.js';

/** Forge step heading and copy; the step is optional for everyone. */
export function onboardingForgeCopy(showGitLab: boolean): {
  title: string;
  before: string;
  after: string;
} {
  return {
    title: showGitLab
      ? m.onboarding_page_connectForge_title()
      : m.onboarding_page_connectGithub_title(),
    before: m.onboarding_page_connectForge_before(),
    after: m.onboarding_page_connectForge_after(),
  };
}
