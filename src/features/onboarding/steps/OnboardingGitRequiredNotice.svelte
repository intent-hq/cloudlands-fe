<script lang="ts">
  /**
   * Onboarding project step (Labs, no forge): Git was not required to finish
   * the requirements gate, so a git project prompts to install it here.
   */
  import Fa from 'svelte-fa';
  import {
    faArrowRotateRight,
    faExternalLinkAlt,
    faTriangleExclamation,
  } from '@fortawesome/free-solid-svg-icons';
  import { notify } from '$lib/components/patterns/notify';
  import { m } from '$shared/paraglide/messages.js';
  import { Button } from '$lib/components/ui/button';
  import { store as appStore } from '$store/renderer/store';
  import { checkHostRequirementsRequested } from '$store/renderer/slices/host-requirements/host-requirements-slice';
  import { handleLink } from '$features/navigation/link-handler';

  function openDownload() {
    void handleLink('https://git-scm.com/downloads', {}).catch(() => {
      notify.error(m.onboarding_requirementsStep_openLinkFailed_error());
    });
  }
</script>

<div
  class="w-full max-w-xl rounded-md border border-warning/30 bg-warning/10 px-4 py-3 text-sm"
  role="alert"
  data-testid="onboarding-git-required"
>
  <div class="flex items-start gap-3">
    <Fa icon={faTriangleExclamation} class="mt-0.5 shrink-0 text-warning-ink" />
    <div class="min-w-0">
      <p class="font-medium text-warning-ink">{m.onboarding_page_gitRequiredForProject_title()}</p>
      <p class="mt-1 text-subtle">{m.onboarding_page_gitRequiredForProject_description()}</p>
      <div class="mt-2 flex flex-wrap gap-2">
        <Button variant="ghost" size="sm" type="button" onclick={openDownload}>
          <Fa icon={faExternalLinkAlt} size="sm" class="mr-1" />
          {m.onboarding_requirementsStep_installGit_label()}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          type="button"
          onclick={() => appStore.dispatch(checkHostRequirementsRequested())}
        >
          <Fa icon={faArrowRotateRight} size="sm" class="mr-1" />
          {m.onboarding_requirementsStep_checkAgain_label()}
        </Button>
      </div>
    </div>
  </div>
</div>
