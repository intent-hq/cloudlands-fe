/**
 * Progress tracking for workspace operations
 */

export interface ProgressStep {
  id: string;
  label: string;
  progress: number;
  status: 'pending' | 'running' | 'completed' | 'error';
  error?: string;
}

export class WorkspaceProgressTracker {
  private steps: ProgressStep[] = [];
  private currentStepIndex = 0;
  private onUpdate?: (steps: ProgressStep[], overall: number) => void;

  constructor(onUpdate?: (steps: ProgressStep[], overall: number) => void) {
    this.onUpdate = onUpdate;
  }

  /**
   * Define the steps for the operation
   */
  setSteps(stepLabels: string[]) {
    this.steps = stepLabels.map((label, index) => ({
      id: `step-${index}`,
      label,
      progress: 0,
      status: 'pending' as const,
    }));
    this.currentStepIndex = 0;
    this.notifyUpdate();
  }

  /**
   * Start a specific step
   */
  startStep(index: number, label?: string) {
    if (index >= 0 && index < this.steps.length) {
      this.currentStepIndex = index;
      this.steps[index].status = 'running';
      this.steps[index].progress = 0;
      if (label) {
        this.steps[index].label = label;
      }
      this.notifyUpdate();
    }
  }

  /**
   * Update progress for current step
   */
  updateProgress(progress: number, label?: string) {
    const step = this.steps[this.currentStepIndex];
    if (step) {
      step.progress = Math.min(100, Math.max(0, progress));
      if (label) {
        step.label = label;
      }
      this.notifyUpdate();
    }
  }

  /**
   * Complete the current step
   */
  completeStep(index?: number) {
    const stepIndex = index ?? this.currentStepIndex;
    if (stepIndex >= 0 && stepIndex < this.steps.length) {
      this.steps[stepIndex].status = 'completed';
      this.steps[stepIndex].progress = 100;
      this.notifyUpdate();
    }
  }

  /**
   * Mark a step as failed
   */
  failStep(error: string, index?: number) {
    const stepIndex = index ?? this.currentStepIndex;
    if (stepIndex >= 0 && stepIndex < this.steps.length) {
      this.steps[stepIndex].status = 'error';
      this.steps[stepIndex].error = error;
      this.notifyUpdate();
    }
  }

  /**
   * Get overall progress
   */
  getOverallProgress(): number {
    if (this.steps.length === 0) return 0;

    const totalProgress = this.steps.reduce((sum, step) => {
      if (step.status === 'completed') return sum + 100;
      if (step.status === 'running') return sum + step.progress;
      return sum;
    }, 0);

    return Math.round(totalProgress / this.steps.length);
  }

  /**
   * Get current status message
   */
  getCurrentStatus(): string {
    const currentStep = this.steps[this.currentStepIndex];
    if (!currentStep) return '';

    if (currentStep.status === 'error') {
      return `Error: ${currentStep.error || 'Unknown error'}`;
    }

    return currentStep.label;
  }

  /**
   * Reset the tracker
   */
  reset() {
    this.steps = [];
    this.currentStepIndex = 0;
    this.notifyUpdate();
  }

  /**
   * Notify listeners of updates
   */
  private notifyUpdate() {
    if (this.onUpdate) {
      this.onUpdate(this.steps, this.getOverallProgress());
    }
  }

  /**
   * Get all steps
   */
  getSteps(): ProgressStep[] {
    return [...this.steps];
  }

  /**
   * Check if all steps are complete
   */
  isComplete(): boolean {
    return this.steps.every((step) => step.status === 'completed');
  }

  /**
   * Check if any step has failed
   */
  hasFailed(): boolean {
    return this.steps.some((step) => step.status === 'error');
  }
}
