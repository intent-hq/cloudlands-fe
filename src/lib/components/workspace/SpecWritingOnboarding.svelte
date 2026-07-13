<script lang="ts">
  /**
   * SpecWritingOnboarding Component
   *
   * Shown when the coordinator agent is writing the initial spec for a new workspace.
   * Sets expectations for the multi-agent coordination workflow.
   */

  import { createLogger } from '$lib/utils/client-logger';
  import { stopAgentSessionRequested } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
  import { store as appStore } from '$store/renderer/store';


  const logger = createLogger('SpecWritingOnboarding');

  interface Props {
    /** The agent ID of the coordinator writing the spec */
    agentId?: string | null;
    workspaceId: string;
  }

  let { agentId, workspaceId }: Props = $props();


  let isStopping = $state(false);

  async function handleStopCoordinator() {
    if (!agentId || isStopping) return;

    isStopping = true;
    try {
      logger.info('User stopping coordinator', { agentId });
      const action = stopAgentSessionRequested(workspaceId, agentId);
      appStore.dispatch(action);
      await action.promise;
    } catch (error) {
      logger.error('Failed to stop coordinator', error as Error, { agentId });
    } finally {
      isStopping = false;
    }
  }
</script>

<div class="spec-writing-onboarding">
  <div class="content">
    <!-- Timeline -->
    <div class="timeline">
      <!-- <Header size={3}>Currently</Header> -->
      <ol class="steps">
        <li class="step current">
          <div class="step-marker">
            <span class="pulse-ring"></span>
            1
          </div>
          <div class="step-content">
            <h4>Creating Spec</h4>
            <p>
              The Coordinator is analyzing your codebase and writing a spec. Once ready, you
              can review, edit, or iterate on it with agents.
            </p>
            <p class="secondary">
              <em>Want to take over?</em>
              <!-- svelte-ignore a11y_missing_attribute -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <a
                onclick={handleStopCoordinator}
                onkeydown={(e) => e.key === 'Enter' && handleStopCoordinator()}
              >
                {isStopping ? 'Stopping...' : 'Stop the Coordinator'}
              </a>
              to edit manually.
            </p>
          </div>
        </li>
        <li class="step">
          <div class="step-marker">2</div>
          <div class="step-content">
            <h4>Implement</h4>
            <p>
              Once you're happy with the spec, ask the Coordinator to start implementing. It will
              delegate tasks to agents—independent tasks run in parallel, dependent ones wait.
            </p>

            <p class="secondary">
              You can always edit the code yourself from the Files tab, or in your usual IDE.
            </p>
          </div>
        </li>

        <li class="step">
          <div class="step-marker">3</div>
          <div class="step-content">
            <h4>Accept changes</h4>
            <p>
              Review the changes in the Changes tab, run from the terminal, or test in a browser
              panel.
            </p>
            <p class="secondary">Stage, commit, create a PR, and/or merge to fit your workflow.</p>
          </div>
        </li>
      </ol>
    </div>
  </div>
</div>

<style>
  .spec-writing-onboarding {
    display: flex;
    flex-direction: column;
    align-items: center;
    height: 100%;
    padding: 5rem 2rem 9rem;
    overflow-y: auto;
  }

  .content {
    max-width: 32rem;
    display: flex;
    flex-direction: column;
    gap: 3rem;
  }

  /* Timeline */
  .timeline {
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .steps {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .step {
    display: flex;
    gap: 1rem;
    padding: 1.3rem 0;
    /* border-bottom: 1px solid hsl(var(--border) / 0.5); */
  }

  .step:last-child {
    border-bottom: none;
  }

  .step-marker {
    position: relative;
    flex-shrink: 0;
    width: 1.5rem;
    height: 1.5rem;
    border-radius: 50%;
    background: hsl(var(--muted));
    color: hsl(var(--muted-foreground));
    font-size: 0.75rem;
    font-weight: 600;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .step.current .step-marker {
    background: hsl(var(--primary));
    color: hsl(var(--primary-foreground));
  }

  .pulse-ring {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    background: radial-gradient(transparent, hsl(var(--primary) / 0.2), hsl(var(--primary) / 0.8));
    animation: pulse-expand 2s ease-out infinite;
    pointer-events: none;
  }

  @keyframes pulse-expand {
    0% {
      transform: scale(1);
      opacity: 0.6;
    }
    100% {
      transform: scale(2);
      opacity: 0;
    }
  }

  .step-content h4 {
    margin: 0 0 0.25rem;
    /* font-size: 0.875rem; */
    font-weight: 600;
    color: hsl(var(--foreground));
  }

  .step.current .step-content h4 {
    color: hsl(var(--primary));
  }

  .step-content p {
    margin: 0;
    /* font-size: 0.8125rem; */
    line-height: 1.5;
    color: hsl(var(--muted-foreground));
  }

  .step-content p.secondary {
    /* font-size: 0.75rem; */
    margin-top: 0.75rem;
  }

  .step-content a {
    color: hsl(var(--primary));
    text-decoration: underline;
    cursor: pointer;
  }
</style>
