/**
 * Performance Worker Thread
 * Handles CPU-intensive tasks off the main thread
 * @ts-check
 */

const { parentPort } = require('worker_threads');
const crypto = require('crypto');

/** @type {Record<string, (data: any) => any>} */
const taskHandlers = {
  /**
   * Parse large JSON data
   */
  parseJSON: (/** @type {string} */ data) => {
    try {
      return JSON.parse(data);
    } catch (error) {
      throw new Error(
        `JSON parse error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },

  /**
   * Stringify with formatting
   */
  stringifyJSON: (/** @type {any} */ data) => {
    try {
      return JSON.stringify(data, null, 2);
    } catch (error) {
      throw new Error(
        `JSON stringify error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },

  /**
   * Hash large content
   */
  hashContent: (/** @type {string} */ content) =>
    crypto.createHash('sha256').update(content).digest('hex'),

  /**
   * Process markdown content
   */
  processMarkdown: (/** @type {string} */ content) => {
    // Simple markdown processing
    const lines = content.split('\n');
    const processed = lines.map((/** @type {string} */ line) => {
      // Convert headers
      if (line.startsWith('#')) {
        const match = line.match(/^#+/);
        const level = match ? match[0].length : 1;
        return { type: 'header', level, content: line.slice(level).trim() };
      }
      // Convert code blocks
      if (line.startsWith('```')) {
        return { type: 'code-fence', content: line };
      }
      // Regular text
      return { type: 'text', content: line };
    });
    return processed;
  },

  /**
   * Diff calculation for large texts
   */
  calculateDiff: (/** @type {{ oldText: string; newText: string }} */ { oldText, newText }) => {
    // Simple line-based diff
    const oldLines = oldText.split('\n');
    const newLines = newText.split('\n');
    const diff = [];

    const maxLen = Math.max(oldLines.length, newLines.length);
    for (let i = 0; i < maxLen; i++) {
      if (oldLines[i] !== newLines[i]) {
        if (i < oldLines.length && i < newLines.length) {
          diff.push({ type: 'modified', line: i + 1, old: oldLines[i], new: newLines[i] });
        } else if (i >= oldLines.length) {
          diff.push({ type: 'added', line: i + 1, content: newLines[i] });
        } else {
          diff.push({ type: 'removed', line: i + 1, content: oldLines[i] });
        }
      }
    }

    return diff;
  },

  /**
   * Search in large text
   */
  searchText: (
    /** @type {{ text: string; pattern: string; caseSensitive?: boolean }} */ {
      text,
      pattern,
      caseSensitive = false,
    },
  ) => {
    const flags = caseSensitive ? 'g' : 'gi';
    const regex = new RegExp(pattern, flags);
    const matches = [];
    let match;

    while ((match = regex.exec(text)) !== null) {
      matches.push({
        index: match.index,
        match: match[0],
        context: text.slice(Math.max(0, match.index - 50), match.index + match[0].length + 50),
      });
    }

    return matches;
  },

  /**
   * Aggregate metrics
   */
  aggregateMetrics: (
    /** @type {Array<{ operation: string; duration: number; success: boolean }>} */ metrics,
  ) => {
    /** @type {Record<string, any>} */
    const aggregated = {};

    metrics.forEach(
      (/** @type {{ operation: string; duration: number; success: boolean }} */ metric) => {
        if (!aggregated[metric.operation]) {
          aggregated[metric.operation] = {
            count: 0,
            totalDuration: 0,
            minDuration: Infinity,
            maxDuration: -Infinity,
            failures: 0,
          };
        }

        const agg = aggregated[metric.operation];
        agg.count++;
        agg.totalDuration += metric.duration;
        agg.minDuration = Math.min(agg.minDuration, metric.duration);
        agg.maxDuration = Math.max(agg.maxDuration, metric.duration);
        if (!metric.success) agg.failures++;
      },
    );

    // Calculate averages
    Object.keys(aggregated).forEach((/** @type {string} */ op) => {
      const agg = aggregated[op];
      agg.avgDuration = agg.totalDuration / agg.count;
      agg.successRate = ((agg.count - agg.failures) / agg.count) * 100;
    });

    return aggregated;
  },
};

// Message handler
if (parentPort) {
  parentPort.on(
    'message',
    async (/** @type {{ task: string; data: any; taskId: string }} */ { task, data, taskId }) => {
      try {
        if (!taskHandlers[task]) {
          throw new Error(`Unknown task: ${task}`);
        }

        const result = await taskHandlers[task](data);
        if (parentPort) {
          parentPort.postMessage({ taskId, success: true, data: result });
        }
      } catch (error) {
        if (parentPort) {
          parentPort.postMessage({
            taskId,
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    },
  );
}
