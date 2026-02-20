/**
 * Terminal UI for Agent Observability
 *
 * Provides a rich terminal interface for viewing agent events in real-time
 * using blessed for terminal UI rendering.
 */

import * as blessed from 'blessed';
import * as fs from 'fs';
import { AgentEvent, AgentEventType, AgentEventFilter, eventCollector } from './event-collector';
import { formatDistanceToNow } from 'date-fns';
import chalk from 'chalk';

/**
 * Terminal Observability UI
 */
export class TerminalObservabilityUI {
  private screen: blessed.Widgets.Screen;
  private eventList: blessed.Widgets.ListElement;
  private detailsBox: blessed.Widgets.BoxElement;
  private metricsBox: blessed.Widgets.BoxElement;
  private filterBox: blessed.Widgets.TextboxElement;
  private statusBar: blessed.Widgets.BoxElement;

  private events: AgentEvent[] = [];
  private selectedIndex: number = 0;
  private filter: AgentEventFilter = {};
  private isPaused: boolean = false;

  constructor() {
    this.screen = this.createScreen();
    this.eventList = this.createEventList();
    this.detailsBox = this.createDetailsBox();
    this.metricsBox = this.createMetricsBox();
    this.filterBox = this.createFilterBox();
    this.statusBar = this.createStatusBar();

    this.setupEventHandlers();
    this.startEventStream();
  }

  /**
   * Create the main screen
   */
  private createScreen(): blessed.Widgets.Screen {
    const screen = blessed.screen({
      smartCSR: true,
      title: 'Augment Agent Observability',
      fullUnicode: true,
    });

    return screen;
  }

  /**
   * Create event list widget
   */
  private createEventList(): blessed.Widgets.ListElement {
    const list = blessed.list({
      parent: this.screen,
      label: ' Events ',
      top: 0,
      left: 0,
      width: '50%',
      height: '70%',
      border: {
        type: 'line',
      },
      style: {
        border: {
          fg: 'cyan',
        },
        selected: {
          bg: 'blue',
          fg: 'white',
        },
      },
      keys: true,
      vi: true,
      mouse: true,
      scrollable: true,
      scrollbar: {
        ch: '█',
        style: {
          bg: 'blue',
        },
      },
    });

    return list;
  }

  /**
   * Create details box widget
   */
  private createDetailsBox(): blessed.Widgets.BoxElement {
    const box = blessed.box({
      parent: this.screen,
      label: ' Event Details ',
      top: 0,
      left: '50%',
      width: '50%',
      height: '70%',
      border: {
        type: 'line',
      },
      style: {
        border: {
          fg: 'green',
        },
      },
      scrollable: true,
      alwaysScroll: true,
      mouse: true,
      content: 'Select an event to view details',
    });

    return box;
  }

  /**
   * Create metrics box widget
   */
  private createMetricsBox(): blessed.Widgets.BoxElement {
    const box = blessed.box({
      parent: this.screen,
      label: ' Metrics ',
      top: '70%',
      left: 0,
      width: '50%',
      height: '25%',
      border: {
        type: 'line',
      },
      style: {
        border: {
          fg: 'yellow',
        },
      },
      content: 'Loading metrics...',
    });

    return box;
  }

  /**
   * Create filter input box
   */
  private createFilterBox(): blessed.Widgets.TextboxElement {
    const box = blessed.textbox({
      parent: this.screen,
      label: ' Filter (/) ',
      top: '70%',
      left: '50%',
      width: '50%',
      height: '25%',
      border: {
        type: 'line',
      },
      style: {
        border: {
          fg: 'magenta',
        },
      },
      inputOnFocus: true,
    });

    return box;
  }

  /**
   * Create status bar
   */
  private createStatusBar(): blessed.Widgets.BoxElement {
    const bar = blessed.box({
      parent: this.screen,
      bottom: 0,
      left: 0,
      width: '100%',
      height: 1,
      style: {
        bg: 'blue',
        fg: 'white',
      },
      content: ' [q]uit | [/]filter | [space]pause | [r]efresh | [e]xport ',
    });

    return bar;
  }

  /**
   * Setup keyboard and mouse event handlers
   */
  private setupEventHandlers(): void {
    // Quit
    this.screen.key(['q', 'C-c'], () => {
      process.exit(0);
    });

    // Filter
    this.screen.key('/', () => {
      this.filterBox.focus();
    });

    // Pause/Resume
    this.screen.key('space', () => {
      this.isPaused = !this.isPaused;
      this.updateStatusBar();
    });

    // Refresh
    this.screen.key('r', () => {
      this.refresh();
    });

    // Export
    this.screen.key('e', () => {
      this.exportEvents();
    });

    // Event list selection
    this.eventList.on('select', (_, index) => {
      this.selectedIndex = index;
      this.showEventDetails();
    });

    // Filter input
    this.filterBox.on('submit', (value) => {
      this.applyFilter(value);
      this.eventList.focus();
    });

    // ESC to cancel filter
    this.filterBox.key('escape', () => {
      this.filterBox.clearValue();
      this.eventList.focus();
    });
  }

  /**
   * Start streaming events
   */
  private startEventStream(): void {
    const stream = eventCollector.subscribe(this.filter);

    stream.on('event', (event: AgentEvent) => {
      if (!this.isPaused) {
        this.addEvent(event);
      }
    });
  }

  /**
   * Add an event to the display
   */
  private addEvent(event: AgentEvent): void {
    this.events.unshift(event); // Add to beginning

    // Limit events to prevent memory issues
    if (this.events.length > 1000) {
      this.events = this.events.slice(0, 1000);
    }

    this.updateEventList();
    this.updateMetrics();
  }

  /**
   * Update the event list display
   */
  private updateEventList(): void {
    const items = this.events.map((event) => {
      const icon = this.getEventIcon(event.type);
      const time = formatDistanceToNow(new Date(event.timestamp), { addSuffix: true });
      const actor = event.actor.name || event.actor.id;

      return `${icon} ${chalk.dim(time)} ${chalk.bold(event.type)} by ${chalk.cyan(actor)}`;
    });

    this.eventList.setItems(items);
    this.screen.render();
  }

  /**
   * Get icon for event type
   */
  private getEventIcon(type: AgentEventType): string {
    const icons: Record<string, string> = {
      [AgentEventType.AGENT_STARTED]: '🚀',
      [AgentEventType.AGENT_COMPLETED]: '✅',
      [AgentEventType.AGENT_ERROR]: '❌',
      [AgentEventType.MESSAGE_RECEIVED]: '📥',
      [AgentEventType.MESSAGE_SENT]: '📤',
      [AgentEventType.TOOL_CALL_STARTED]: '🔧',
      [AgentEventType.TOOL_CALL_COMPLETED]: '✔️',
      [AgentEventType.FILE_CREATED]: '📄',
      [AgentEventType.FILE_MODIFIED]: '✏️',
      [AgentEventType.FILE_DELETED]: '🗑️',
      [AgentEventType.GIT_COMMIT]: '💾',
      [AgentEventType.THINKING_STARTED]: '🤔',
      [AgentEventType.DECISION_MADE]: '💡',
      [AgentEventType.ERROR_OCCURRED]: '⚠️',
    };

    return icons[type] || '•';
  }

  /**
   * Show details for selected event
   */
  private showEventDetails(): void {
    if (this.selectedIndex >= 0 && this.selectedIndex < this.events.length) {
      const event = this.events[this.selectedIndex];

      const details = [
        `${chalk.bold('Event ID:')} ${event.id}`,
        `${chalk.bold('Type:')} ${event.type}`,
        `${chalk.bold('Timestamp:')} ${event.timestamp}`,
        `${chalk.bold('Session:')} ${event.sessionId}`,
        `${chalk.bold('Agent:')} ${event.agentId}`,
        '',
        chalk.bold('Actor:'),
        JSON.stringify(event.actor, null, 2),
        '',
        chalk.bold('Data:'),
        JSON.stringify(event.data, null, 2),
      ];

      if (event.metadata) {
        details.push('', chalk.bold('Metadata:'));
        details.push(JSON.stringify(event.metadata, null, 2));
      }

      this.detailsBox.setContent(details.join('\n'));
      this.screen.render();
    }
  }

  /**
   * Update metrics display
   */
  private updateMetrics(): void {
    const metrics = this.calculateMetrics();

    const content = [
      chalk.bold('Session Metrics:'),
      `Total Events: ${metrics.totalEvents}`,
      `Tool Calls: ${metrics.toolCalls}`,
      `Errors: ${metrics.errors}`,
      `Files Modified: ${metrics.filesModified}`,
      `Total Tokens: ${metrics.totalTokens}`,
      `Estimated Cost: $${metrics.estimatedCost.toFixed(4)}`,
    ].join('\n');

    this.metricsBox.setContent(content);
    this.screen.render();
  }

  /**
   * Calculate metrics from events
   */
  private calculateMetrics(): any {
    const metrics = {
      totalEvents: this.events.length,
      toolCalls: 0,
      errors: 0,
      filesModified: 0,
      totalTokens: 0,
      estimatedCost: 0,
    };

    for (const event of this.events) {
      if (event.type === AgentEventType.TOOL_CALL_STARTED) {
        metrics.toolCalls++;
      }
      if (event.type === AgentEventType.ERROR_OCCURRED) {
        metrics.errors++;
      }
      if (event.type === AgentEventType.FILE_MODIFIED) {
        metrics.filesModified++;
      }
      if (event.metadata?.tokenUsage) {
        metrics.totalTokens += event.metadata.tokenUsage.total;
      }
      if (event.metadata?.cost) {
        metrics.estimatedCost += event.metadata.cost;
      }
    }

    return metrics;
  }

  /**
   * Apply filter to events
   */
  private applyFilter(filterString: string): void {
    // Parse filter string (simple implementation)
    // Format: "type:tool:* actor:agent"
    const parts = filterString.split(' ');
    const filter: AgentEventFilter = {};

    for (const part of parts) {
      const [key, value] = part.split(':');
      if (key === 'type' && value) {
        // Handle wildcards
        if (value.includes('*')) {
          const prefix = value.replace('*', '');
          filter.types = Object.values(AgentEventType).filter((t) =>
            t.startsWith(prefix),
          ) as AgentEventType[];
        } else {
          filter.types = [value as AgentEventType];
        }
      }
      // Add more filter parsing as needed
    }

    this.filter = filter;
    this.refresh();
  }

  /**
   * Refresh the display
   */
  private refresh(): void {
    this.events = [];
    this.updateEventList();
    this.updateMetrics();
    this.startEventStream();
  }

  /**
   * Update status bar
   */
  private updateStatusBar(): void {
    const status = this.isPaused ? ' [PAUSED] ' : ' [LIVE] ';
    const content = `${status}[q]uit | [/]filter | [space]pause | [r]efresh | [e]xport `;
    this.statusBar.setContent(content);
    this.screen.render();
  }

  /**
   * Export events to file
   */
  private exportEvents(): void {
    const filename = `events-${Date.now()}.json`;
    fs.writeFileSync(filename, JSON.stringify(this.events, null, 2));

    // Show notification
    const notification = blessed.message({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: '50%',
      height: 'shrink',
      border: {
        type: 'line',
      },
      style: {
        border: {
          fg: 'green',
        },
      },
    });

    notification.display(`Events exported to ${filename}`, 2, () => {
      this.screen.render();
    });
  }

  /**
   * Start the UI
   */
  start(): void {
    this.screen.render();
  }
}

// Export function to launch the UI
export function launchObservabilityUI(): void {
  const ui = new TerminalObservabilityUI();
  ui.start();
}
