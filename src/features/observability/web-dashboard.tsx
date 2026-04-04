/**
 * Web Dashboard for Agent Observability
 *
 * React component that provides a web-based interface for viewing
 * agent events in real-time with rich visualizations.
 */

import React, { useState, useEffect, useRef } from 'react';
import { AgentEvent, AgentEventType, EventFilter } from './event-collector';
import { formatDistanceToNow } from 'date-fns';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

interface ObservabilityDashboardProps {
  sessionId?: string;
  agentId?: string;
  workspaceId?: string;
}

/**
 * Main dashboard component
 */
export const ObservabilityDashboard: React.FC<ObservabilityDashboardProps> = ({
  sessionId,
  agentId,
  workspaceId,
}) => {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<AgentEvent | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [filter, setFilter] = useState<EventFilter>({});
  const [isPaused, setIsPaused] = useState(false);
  const [metrics, setMetrics] = useState<any>({});
  const eventSourceRef = useRef<EventSource | null>(null);

  // Connect to event stream
  useEffect(() => {
    if (!isPaused) {
      const params = new URLSearchParams();
      if (sessionId) params.append('sessionId', sessionId);
      if (agentId) params.append('agentId', agentId);
      if (workspaceId) params.append('workspaceId', workspaceId);

      const eventSource = new EventSource(`/api/observability/stream?${params.toString()}`);

      eventSource.onmessage = (event) => {
        const agentEvent: AgentEvent = JSON.parse(event.data);
        setEvents((prev) => [agentEvent, ...prev].slice(0, 1000)); // Keep last 1000
      };

      eventSource.onerror = (error) => {
        console.error('EventSource error:', error);
      };

      eventSourceRef.current = eventSource;

      return () => {
        eventSource.close();
      };
    }
  }, [sessionId, agentId, workspaceId, isPaused]);

  // Calculate metrics
  useEffect(() => {
    const newMetrics = calculateMetrics(events);
    setMetrics(newMetrics);
  }, [events]);

  return (
    <div className="observability-dashboard">
      <Header
        isPaused={isPaused}
        onTogglePause={() => setIsPaused(!isPaused)}
        onExport={() => exportEvents(events)}
      />

      <div className="dashboard-grid">
        <EventTimeline
          events={events}
          selectedEvent={selectedEvent}
          onSelectEvent={setSelectedEvent}
        />

        <EventDetails event={selectedEvent} />

        <MetricsPanel metrics={metrics} />

        <PerformanceCharts events={events} />
      </div>
    </div>
  );
};

/**
 * Dashboard header with controls
 */
const Header: React.FC<{
  isPaused: boolean;
  onTogglePause: () => void;
  onExport: () => void;
}> = ({ isPaused, onTogglePause, onExport }) => (
  <header className="dashboard-header">
    <h1>🔍 Agent Observability Dashboard</h1>
    <div className="controls">
      <button onClick={onTogglePause} className={isPaused ? 'paused' : 'live'}>
        {isPaused ? '▶️ Resume' : '⏸️ Pause'}
      </button>
      <button onClick={onExport}>📥 Export</button>
    </div>
  </header>
);

/**
 * Event timeline component
 */
const EventTimeline: React.FC<{
  events: AgentEvent[];
  selectedEvent: AgentEvent | null;
  onSelectEvent: (event: AgentEvent) => void;
}> = ({ events, selectedEvent, onSelectEvent }) => (
  <div className="event-timeline">
    <h2>Event Timeline</h2>
    <div className="timeline-container">
      {events.map((event) => (
        <EventItem
          key={event.id}
          event={event}
          isSelected={selectedEvent?.id === event.id}
          onClick={() => onSelectEvent(event)}
        />
      ))}
    </div>
  </div>
);

/**
 * Individual event item in timeline
 */
const EventItem: React.FC<{
  event: AgentEvent;
  isSelected: boolean;
  onClick: () => void;
}> = ({ event, isSelected, onClick }) => {
  const icon = getEventIcon(event.type);
  const time = formatDistanceToNow(new Date(event.timestamp), { addSuffix: true });

  return (
    <div className={`event-item ${isSelected ? 'selected' : ''} ${event.type}`} onClick={onClick}>
      <span className="event-icon">{icon}</span>
      <div className="event-content">
        <div className="event-header">
          <span className="event-type">{event.type}</span>
          <span className="event-time">{time}</span>
        </div>
        <div className="event-actor">{event.actor.name || event.actor.id}</div>
      </div>
    </div>
  );
};

/**
 * Event details panel
 */
const EventDetails: React.FC<{ event: AgentEvent | null }> = ({ event }) => {
  if (!event) {
    return (
      <div className="event-details">
        <h2>Event Details</h2>
        <p className="no-selection">Select an event to view details</p>
      </div>
    );
  }

  return (
    <div className="event-details">
      <h2>Event Details</h2>
      <div className="details-content">
        <div className="detail-group">
          <label>Event ID:</label>
          <span>{event.id}</span>
        </div>
        <div className="detail-group">
          <label>Type:</label>
          <span className={`event-type ${event.type}`}>{event.type}</span>
        </div>
        <div className="detail-group">
          <label>Timestamp:</label>
          <span>{new Date(event.timestamp).toLocaleString()}</span>
        </div>
        <div className="detail-group">
          <label>Actor:</label>
          <pre>{JSON.stringify(event.actor, null, 2)}</pre>
        </div>
        <div className="detail-group">
          <label>Data:</label>
          <pre>{JSON.stringify(event.data, null, 2)}</pre>
        </div>
        {event.metadata && (
          <div className="detail-group">
            <label>Metadata:</label>
            <pre>{JSON.stringify(event.metadata, null, 2)}</pre>
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * Metrics panel
 */
const MetricsPanel: React.FC<{ metrics: any }> = ({ metrics }) => (
  <div className="metrics-panel">
    <h2>Session Metrics</h2>
    <div className="metrics-grid">
      <MetricCard label="Total Events" value={metrics.totalEvents || 0} icon="📊" />
      <MetricCard label="Tool Calls" value={metrics.toolCalls || 0} icon="🔧" />
      <MetricCard label="Errors" value={metrics.errors || 0} icon="⚠️" className="error" />
      <MetricCard label="Files Modified" value={metrics.filesModified || 0} icon="📝" />
      <MetricCard label="Total Tokens" value={metrics.totalTokens || 0} icon="🎯" />
      <MetricCard
        label="Est. Cost"
        value={`$${(metrics.estimatedCost || 0).toFixed(4)}`}
        icon="💰"
      />
    </div>
  </div>
);

/**
 * Individual metric card
 */
const MetricCard: React.FC<{
  label: string;
  value: string | number;
  icon: string;
  className?: string;
}> = ({ label, value, icon, className = '' }) => (
  <div className={`metric-card ${className}`}>
    <span className="metric-icon">{icon}</span>
    <div className="metric-content">
      <div className="metric-value">{value}</div>
      <div className="metric-label">{label}</div>
    </div>
  </div>
);

/**
 * Performance charts
 */
const PerformanceCharts: React.FC<{ events: AgentEvent[] }> = ({ events }) => {
  const chartData = prepareChartData(events);

  return (
    <div className="performance-charts">
      <h2>Performance Analytics</h2>

      <div className="chart-container">
        <h3>Token Usage Over Time</h3>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={chartData.tokenUsage}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="time" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="tokens" stroke="#8884d8" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="chart-container">
        <h3>Tool Call Distribution</h3>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData.toolDistribution}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="tool" />
            <YAxis />
            <Tooltip />
            <Bar dataKey="count" fill="#82ca9d" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

// Helper functions

function getEventIcon(type: AgentEventType): string {
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

function calculateMetrics(events: AgentEvent[]): any {
  const metrics = {
    totalEvents: events.length,
    toolCalls: 0,
    errors: 0,
    filesModified: 0,
    totalTokens: 0,
    estimatedCost: 0,
  };

  for (const event of events) {
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function prepareChartData(events: AgentEvent[]): any {
  // Prepare data for charts
  // This is a simplified implementation
  return {
    tokenUsage: [],
    toolDistribution: [],
  };
}

function exportEvents(events: AgentEvent[]): void {
  const dataStr = JSON.stringify(events, null, 2);
  const dataUri = `data:application/json;charset=utf-8,${encodeURIComponent(dataStr)}`;

  const exportFileDefaultName = `events-${Date.now()}.json`;

  const linkElement = document.createElement('a');
  linkElement.setAttribute('href', dataUri);
  linkElement.setAttribute('download', exportFileDefaultName);
  linkElement.click();
}
