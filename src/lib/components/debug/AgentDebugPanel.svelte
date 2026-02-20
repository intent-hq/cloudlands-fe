<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { TestMetrics } from '../../../features/agent/testing/agent-test-harness';
  import type { TestReport } from '../../../features/agent/testing/agent-test-runner';
  import AgentMetrics from './AgentMetrics.svelte';

  interface Props {
    visible?: boolean;
    metrics?: TestMetrics | null;
    report?: TestReport | null;
  }

  let { visible = $bindable(false), metrics = null, report = null }: Props = $props();

  let activeTab: 'metrics' | 'errors' | 'memory' | 'performance' = $state('metrics');
  let autoRefresh: boolean = $state(false);
  let refreshInterval: number = $state(1000);
  let refreshTimer: ReturnType<typeof setInterval> | null = $state(null);

  $effect(() => {
    if (autoRefresh && visible) {
      startAutoRefresh();
    } else {
      stopAutoRefresh();
    }
  });

  function startAutoRefresh() {
    stopAutoRefresh();
    refreshTimer = setInterval(() => {
      // Emit refresh event
      dispatchEvent(new CustomEvent('refresh'));
    }, refreshInterval);
  }

  function stopAutoRefresh() {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
  }

  function formatBytes(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(2)} ${units[unitIndex]}`;
  }

  function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms.toFixed(0)}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
    return `${(ms / 60000).toFixed(2)}m`;
  }

  onDestroy(() => {
    stopAutoRefresh();
  });
</script>

{#if visible}
  <div class="debug-panel">
    <div class="debug-header">
      <h3>Agent Debug Panel</h3>
      <div class="debug-controls">
        <label>
          <input type="checkbox" bind:checked={autoRefresh} />
          Auto-refresh
        </label>
        {#if autoRefresh}
          <select bind:value={refreshInterval}>
            <option value={500}>500ms</option>
            <option value={1000}>1s</option>
            <option value={2000}>2s</option>
            <option value={5000}>5s</option>
          </select>
        {/if}
        <button onclick={() => (visible = false)}>×</button>
      </div>
    </div>

    <div class="debug-tabs">
      <button class:active={activeTab === 'metrics'} onclick={() => (activeTab = 'metrics')}>
        Metrics
      </button>
      <button class:active={activeTab === 'errors'} onclick={() => (activeTab = 'errors')}>
        Errors ({metrics?.errors.length || 0})
      </button>
      <button class:active={activeTab === 'memory'} onclick={() => (activeTab = 'memory')}>
        Memory
      </button>
      <button
        class:active={activeTab === 'performance'}
        onclick={() => (activeTab = 'performance')}
      >
        Performance
      </button>
    </div>

    <div class="debug-content">
      {#if activeTab === 'metrics'}
        {#if metrics}
          <AgentMetrics {metrics} />
        {:else}
          <p class="no-data">No metrics available</p>
        {/if}
      {:else if activeTab === 'errors'}
        {#if metrics?.errors && metrics.errors.length > 0}
          <div class="error-list">
            {#each metrics.errors as error, errorIndex (`error-${errorIndex}-${error.timestamp}`)}
              <div class="error-item">
                <div class="error-header">
                  <span class="error-phase">{error.phase}</span>
                  <span class="error-time">
                    {new Date(error.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                <div class="error-message">{error.error.message}</div>
                {#if error.context}
                  <details>
                    <summary>Context</summary>
                    <pre>{JSON.stringify(error.context, null, 2)}</pre>
                  </details>
                {/if}
                {#if error.stack}
                  <details>
                    <summary>Stack Trace</summary>
                    <pre>{error.stack}</pre>
                  </details>
                {/if}
              </div>
            {/each}
          </div>
        {:else}
          <p class="no-data">No errors recorded</p>
        {/if}
      {:else if activeTab === 'memory'}
        {#if metrics?.memoryUsage}
          <div class="memory-info">
            <div class="memory-stat">
              <span class="stat-label">Initial Heap:</span>
              <span>{formatBytes(metrics.memoryUsage.initial.heapUsed)}</span>
            </div>
            <div class="memory-stat">
              <span class="stat-label">Current Heap:</span>
              <span>{formatBytes(metrics.memoryUsage.current.heapUsed)}</span>
            </div>
            <div class="memory-stat">
              <span class="stat-label">Peak Heap:</span>
              <span>{formatBytes(metrics.memoryUsage.peak.heapUsed)}</span>
            </div>
            <div class="memory-stat">
              <span class="stat-label">External:</span>
              <span>{formatBytes(metrics.memoryUsage.current.external)}</span>
            </div>

            {#if metrics.memoryUsage.leaks.length > 0}
              <div class="memory-leaks">
                <h4>⚠️ Memory Leaks Detected</h4>
                {#each metrics.memoryUsage.leaks as leak, leakIndex (`leak-${leakIndex}-${leak.type}-${leak.location}`)}
                  <div class="leak-item">
                    <span class="leak-type">{leak.type}</span>
                    <span class="leak-size">{formatBytes(leak.size)}</span>
                    <span class="leak-location">{leak.location}</span>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {:else}
          <p class="no-data">No memory data available</p>
        {/if}
      {:else if activeTab === 'performance'}
        {#if metrics?.performance}
          <div class="performance-info">
            <div class="performance-summary">
              <div class="perf-stat">
                <span class="stat-label">Average Response:</span>
                <span>{formatDuration(metrics.performance.averageResponseTime)}</span>
              </div>
              <div class="perf-stat">
                <span class="stat-label">P95 Response:</span>
                <span>{formatDuration(metrics.performance.p95ResponseTime)}</span>
              </div>
              <div class="perf-stat">
                <span class="stat-label">P99 Response:</span>
                <span>{formatDuration(metrics.performance.p99ResponseTime)}</span>
              </div>
            </div>

            {#if metrics.performance.operations.length > 0}
              <div class="operations-list">
                <h4>Recent Operations</h4>
                {#each metrics.performance.operations.slice(-10) as op, opIndex (`op-${opIndex}-${op.name}`)}
                  <div class="operation-item" class:failed={!op.success}>
                    <span class="op-name">{op.name}</span>
                    <span class="op-duration">{formatDuration(op.duration)}</span>
                    <span class="op-status">{op.success ? '✓' : '✗'}</span>
                  </div>
                {/each}
              </div>
            {/if}

            {#if metrics.warnings.length > 0}
              <div class="performance-warnings">
                <h4>Performance Warnings</h4>
                {#each metrics.warnings as warning, warningIndex (`warning-${warningIndex}`)}
                  <div class="warning-item">⚠️ {warning}</div>
                {/each}
              </div>
            {/if}
          </div>
        {:else}
          <p class="no-data">No performance data available</p>
        {/if}
      {/if}
    </div>

    {#if report}
      <div class="report-summary">
        <h4>Test Report Summary</h4>
        <div class="summary-stats">
          <span class="stat passed">✓ {report.summary.passed}</span>
          <span class="stat failed">✗ {report.summary.failed}</span>
          <span class="stat skipped">⊘ {report.summary.skipped}</span>
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .debug-panel {
    position: fixed;
    bottom: 0;
    right: 0;
    width: 400px;
    max-height: 600px;
    background: var(--color-bg-primary);
    border: 1px solid var(--color-border);
    border-radius: 8px 0 0 0;
    box-shadow: -2px -2px 10px rgba(0, 0, 0, 0.1);
    display: flex;
    flex-direction: column;
    z-index: 1000;
  }

  .debug-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    border-bottom: 1px solid var(--color-border);
    background: var(--color-bg-secondary);
  }

  .debug-header h3 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
  }

  .debug-controls {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .debug-controls label {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
  }

  .debug-controls select {
    font-size: 12px;
    padding: 2px 4px;
  }

  .debug-controls button {
    background: none;
    border: none;
    font-size: 20px;
    cursor: pointer;
    padding: 0;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .debug-tabs {
    display: flex;
    border-bottom: 1px solid var(--color-border);
    background: var(--color-bg-secondary);
  }

  .debug-tabs button {
    flex: 1;
    padding: 8px;
    background: none;
    border: none;
    font-size: 12px;
    cursor: pointer;
    position: relative;
  }

  .debug-tabs button.active {
    font-weight: 600;
  }

  .debug-tabs button.active::after {
    content: '';
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 2px;
    background: var(--color-primary);
  }

  .debug-content {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
  }

  .no-data {
    color: var(--color-text-secondary);
    text-align: center;
    padding: 32px;
    font-size: 14px;
  }

  .error-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .error-item {
    background: var(--color-bg-secondary);
    border: 1px solid var(--color-border);
    border-radius: 4px;
    padding: 12px;
  }

  .error-header {
    display: flex;
    justify-content: space-between;
    margin-bottom: 8px;
  }

  .error-phase {
    font-size: 11px;
    text-transform: uppercase;
    background: var(--color-error-bg);
    color: var(--color-error);
    padding: 2px 6px;
    border-radius: 3px;
  }

  .error-time {
    font-size: 11px;
    color: var(--color-text-secondary);
  }

  .error-message {
    font-size: 13px;
    color: var(--color-error);
    margin-bottom: 8px;
  }

  details {
    font-size: 12px;
    margin-top: 8px;
  }

  details summary {
    cursor: pointer;
    color: var(--color-text-secondary);
  }

  details pre {
    margin: 8px 0 0 0;
    padding: 8px;
    background: var(--color-bg-tertiary);
    border-radius: 3px;
    font-size: 11px;
    overflow-x: auto;
  }

  .memory-info,
  .performance-info {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .memory-stat,
  .perf-stat {
    display: flex;
    justify-content: space-between;
    font-size: 13px;
  }

  .memory-stat .stat-label,
  .perf-stat .stat-label {
    color: var(--color-text-secondary);
  }

  .memory-leaks {
    background: var(--color-warning-bg);
    border: 1px solid var(--color-warning);
    border-radius: 4px;
    padding: 12px;
  }

  .memory-leaks h4 {
    margin: 0 0 8px 0;
    font-size: 13px;
    color: var(--color-warning);
  }

  .leak-item {
    display: flex;
    gap: 8px;
    font-size: 12px;
    margin-top: 4px;
  }

  .leak-type {
    font-weight: 600;
  }

  .leak-size {
    color: var(--color-error);
  }

  .operations-list {
    background: var(--color-bg-secondary);
    border-radius: 4px;
    padding: 12px;
  }

  .operations-list h4 {
    margin: 0 0 8px 0;
    font-size: 13px;
  }

  .operation-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 4px 0;
    font-size: 12px;
  }

  .operation-item.failed {
    color: var(--color-error);
  }

  .op-name {
    flex: 1;
  }

  .op-duration {
    color: var(--color-text-secondary);
    margin: 0 8px;
  }

  .op-status {
    width: 20px;
    text-align: center;
  }

  .performance-warnings {
    background: var(--color-warning-bg);
    border: 1px solid var(--color-warning);
    border-radius: 4px;
    padding: 12px;
  }

  .performance-warnings h4 {
    margin: 0 0 8px 0;
    font-size: 13px;
    color: var(--color-warning);
  }

  .warning-item {
    font-size: 12px;
    margin-top: 4px;
  }

  .report-summary {
    padding: 12px 16px;
    border-top: 1px solid var(--color-border);
    background: var(--color-bg-secondary);
  }

  .report-summary h4 {
    margin: 0 0 8px 0;
    font-size: 13px;
  }

  .summary-stats {
    display: flex;
    gap: 16px;
    font-size: 14px;
  }

  .stat.passed {
    color: var(--color-success);
  }

  .stat.failed {
    color: var(--color-error);
  }

  .stat.skipped {
    color: var(--color-text-secondary);
  }
</style>
