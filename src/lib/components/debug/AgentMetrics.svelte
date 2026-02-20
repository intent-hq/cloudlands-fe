<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { TestMetrics } from '../../../features/agent/testing/agent-test-harness';

  interface Props {
    metrics: TestMetrics;
    showCharts?: boolean;
  }

  let { metrics, showCharts = true }: Props = $props();

  let canvas: HTMLCanvasElement | undefined = $state(undefined);
  let ctx: CanvasRenderingContext2D | null = $state(null);
  let animationFrame: number | null = $state(null);

  // Chart data
  let memoryHistory: number[] = $state([]);
  let performanceHistory: number[] = $state([]);
  const maxHistoryLength = 50;

  $effect(() => {
    if (metrics) {
      updateHistory();
    }
  });

  function updateHistory() {
    // Update memory history
    const currentMemory = metrics.memoryUsage.current.heapUsed;
    memoryHistory = [...memoryHistory, currentMemory].slice(-maxHistoryLength);

    // Update performance history
    const lastOp = metrics.performance.operations[metrics.performance.operations.length - 1];
    if (lastOp) {
      performanceHistory = [...performanceHistory, lastOp.duration].slice(-maxHistoryLength);
    }

    if (showCharts && ctx) {
      drawCharts();
    }
  }

  function drawCharts() {
    if (!ctx || !canvas) return;

    const width = canvas.width;
    const height = canvas.height;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Draw memory chart
    drawChart(
      ctx,
      memoryHistory,
      0,
      0,
      width / 2 - 5,
      height,
      '#4CAF50',
      'Memory (MB)',
      (v) => v / (1024 * 1024),
    );

    // Draw performance chart
    drawChart(
      ctx,
      performanceHistory,
      width / 2 + 5,
      0,
      width / 2 - 5,
      height,
      '#2196F3',
      'Response (ms)',
      (v) => v,
    );
  }

  function drawChart(
    ctx: CanvasRenderingContext2D,
    data: number[],
    x: number,
    y: number,
    width: number,
    height: number,
    color: string,
    label: string,
    transform: (value: number) => number,
  ) {
    if (data.length === 0) return;

    // Background
    ctx.fillStyle = '#f5f5f5';
    ctx.fillRect(x, y, width, height);

    // Title
    ctx.fillStyle = '#333';
    ctx.font = '12px sans-serif';
    ctx.fillText(label, x + 5, y + 15);

    // Calculate scale
    const transformedData = data.map(transform);
    const maxValue = Math.max(...transformedData);
    const minValue = Math.min(...transformedData);
    const range = maxValue - minValue || 1;

    // Draw grid lines
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const gridY = y + 20 + (height - 30) * (i / 4);
      ctx.beginPath();
      ctx.moveTo(x, gridY);
      ctx.lineTo(x + width, gridY);
      ctx.stroke();
    }

    // Draw data line
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();

    transformedData.forEach((value, index) => {
      const dataX = x + (index / (maxHistoryLength - 1)) * width;
      const dataY = y + height - 10 - ((value - minValue) / range) * (height - 30);

      if (index === 0) {
        ctx.moveTo(dataX, dataY);
      } else {
        ctx.lineTo(dataX, dataY);
      }
    });

    ctx.stroke();

    // Draw current value
    const currentValue = transformedData[transformedData.length - 1];
    ctx.fillStyle = color;
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText(currentValue.toFixed(2), x + width - 50, y + 15);
  }

  onMount(() => {
    if (canvas) {
      ctx = canvas.getContext('2d');
      if (ctx) {
        // Set canvas size
        canvas.width = canvas.offsetWidth;
        canvas.height = 150;
        drawCharts();
      }
    }
  });

  onDestroy(() => {
    if (animationFrame) {
      cancelAnimationFrame(animationFrame);
    }
  });

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

  function getHealthStatus(): { status: 'good' | 'warning' | 'critical'; message: string } {
    const hasErrors = metrics.errors.length > 0;
    const hasLeaks = metrics.memoryUsage.leaks.length > 0;
    const hasPerformanceIssues = metrics.warnings.length > 0;

    if (hasErrors || hasLeaks) {
      return {
        status: 'critical',
        message: `${hasErrors ? 'Errors detected' : ''}${hasErrors && hasLeaks ? ', ' : ''}${hasLeaks ? 'Memory leaks found' : ''}`,
      };
    }

    if (hasPerformanceIssues) {
      return {
        status: 'warning',
        message: 'Performance issues detected',
      };
    }

    return {
      status: 'good',
      message: 'All systems operational',
    };
  }
</script>

<div class="metrics-container">
  {#if showCharts}
    <canvas bind:this={canvas} class="metrics-chart"></canvas>
  {/if}

  <div class="metrics-grid">
    <div class="metric-card">
      <div class="metric-label">Health Status</div>
      <div class="metric-value health-{getHealthStatus().status}">
        {getHealthStatus().message}
      </div>
    </div>

    <div class="metric-card">
      <div class="metric-label">Memory Usage</div>
      <div class="metric-value">
        {formatBytes(metrics.memoryUsage.current.heapUsed)}
      </div>
      <div class="metric-detail">
        Peak: {formatBytes(metrics.memoryUsage.peak.heapUsed)}
      </div>
    </div>

    <div class="metric-card">
      <div class="metric-label">Operations</div>
      <div class="metric-value">
        {metrics.performance.operations.length}
      </div>
      <div class="metric-detail">
        {metrics.performance.operations.filter((op) => op.success).length} successful
      </div>
    </div>

    <div class="metric-card">
      <div class="metric-label">Avg Response</div>
      <div class="metric-value">
        {formatDuration(metrics.performance.averageResponseTime)}
      </div>
      <div class="metric-detail">
        P95: {formatDuration(metrics.performance.p95ResponseTime)}
      </div>
    </div>

    <div class="metric-card">
      <div class="metric-label">Errors</div>
      <div class="metric-value" class:has-errors={metrics.errors.length > 0}>
        {metrics.errors.length}
      </div>
      <div class="metric-detail">
        {metrics.warnings.length} warnings
      </div>
    </div>

    <div class="metric-card">
      <div class="metric-label">Memory Leaks</div>
      <div class="metric-value" class:has-leaks={metrics.memoryUsage.leaks.length > 0}>
        {metrics.memoryUsage.leaks.length}
      </div>
      <div class="metric-detail">
        {metrics.memoryUsage.leaks.reduce((sum, leak) => sum + leak.size, 0) > 0
          ? formatBytes(metrics.memoryUsage.leaks.reduce((sum, leak) => sum + leak.size, 0))
          : 'None detected'}
      </div>
    </div>

    {#if metrics.coverage.totalLines > 0}
      <div class="metric-card">
        <div class="metric-label">Code Coverage</div>
        <div class="metric-value">
          {metrics.coverage.percentage.toFixed(1)}%
        </div>
        <div class="metric-detail">
          {metrics.coverage.linesExecuted}/{metrics.coverage.totalLines} lines
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .metrics-container {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .metrics-chart {
    width: 100%;
    height: 150px;
    border: 1px solid var(--color-border);
    border-radius: 4px;
  }

  .metrics-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 12px;
  }

  .metric-card {
    background: var(--color-bg-secondary);
    border: 1px solid var(--color-border);
    border-radius: 4px;
    padding: 12px;
  }

  .metric-label {
    font-size: 11px;
    text-transform: uppercase;
    color: var(--color-text-secondary);
    margin-bottom: 4px;
  }

  .metric-value {
    font-size: 20px;
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .metric-detail {
    font-size: 11px;
    color: var(--color-text-secondary);
    margin-top: 4px;
  }

  .health-good {
    color: var(--color-success);
    font-size: 14px;
  }

  .health-warning {
    color: var(--color-warning);
    font-size: 14px;
  }

  .health-critical {
    color: var(--color-error);
    font-size: 14px;
  }

  .has-errors {
    color: var(--color-error);
  }

  .has-leaks {
    color: var(--color-warning);
  }
</style>
