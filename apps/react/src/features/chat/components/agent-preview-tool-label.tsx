// Source: src/lib/components/chat/AgentPreviewToolLabel.svelte.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { IconDefinitionIcon } from '@/components/icons/icon-definition';
import { McpIcon } from '@/features/settings/mcp/mcp-icon';
import { truncatedTitle } from '$lib/actions/observe-overflow';
import { renderInlineMarkdownPlainText } from '$lib/components/chat/inline-markdown-snippet';
import { classifyTool } from '$lib/utils/tool-classifier';
import { m } from '$shared/paraglide/messages.js';
import type { ToolUseBlock } from '$shared/types';
import './agent-preview-tool-label.css';

const BRANDED_MCP_ICONS = new Set([
  'figma',
  'sentry',
  'playwright',
  'github',
  'linear',
  'slack',
  'context7',
]);

export interface AgentPreviewToolLabelProps {
  toolUse: ToolUseBlock;
  /** Pulse the icon to indicate the tool is actively running. */
  animate?: boolean;
  /** Icon wrapper size; also passed to branded MCP icons. */
  iconSize?: number;
  showIcon?: boolean;
  /** Source spelling, retained for existing callers. */
  class?: string;
  /** React spelling takes precedence when both class props are supplied. */
  className?: string;
}

export function AgentPreviewToolLabel({
  toolUse,
  animate = false,
  iconSize = 12,
  showIcon = true,
  class: sourceClass = '',
  className = sourceClass,
}: AgentPreviewToolLabelProps) {
  const toolDisplay = classifyTool(toolUse.name, (toolUse.input as Record<string, unknown>) || {});
  const parts = [toolDisplay.verb, toolDisplay.subject, toolDisplay.path].filter(Boolean);
  const text = parts.join(' ').trim();
  const rawLabel = text || toolDisplay.verb || m.chat_previewToolLabel_tool_fallback();
  const [label, setLabel] = useState('');
  const labelNode = useRef<HTMLSpanElement>(null);
  const titleAction = useRef<ReturnType<typeof truncatedTitle>>(undefined);
  const hidden = Boolean(toolDisplay.hidden);

  useEffect(() => {
    let cancelled = false;
    void renderInlineMarkdownPlainText(rawLabel).then((cleaned) => {
      if (!cancelled) setLabel(cleaned);
    });
    return () => {
      cancelled = true;
    };
  }, [rawLabel]);

  useLayoutEffect(() => {
    if (!labelNode.current) return;
    const action = truncatedTitle(labelNode.current, undefined);
    titleAction.current = action;
    return () => {
      action?.destroy?.();
      titleAction.current = undefined;
    };
    // Hiding the row destroys the node; showing it creates a new observer owner.
  }, [hidden]);

  useLayoutEffect(() => {
    titleAction.current?.update?.(label);
  }, [label, hidden]);

  if (hidden) return null;

  return (
    <span
      className={`type-body inline-flex w-full min-w-0 items-center font-normal ${showIcon ? 'gap-1.5' : ''} ${className}`}
    >
      {showIcon && (
        <span
          className={`agent-preview-tool-icon intent-agent-preview-tool-icon inline-flex shrink-0 items-center justify-center text-inherit opacity-[inherit] ${animate ? 'animate-pulse' : ''}`}
          style={{ width: iconSize, height: iconSize }}
          data-testid="agent-preview-tool-icon"
        >
          {toolDisplay.mcpSource && BRANDED_MCP_ICONS.has(toolDisplay.mcpSource) ? (
            <McpIcon
              iconName={toolDisplay.mcpSource}
              label={toolDisplay.mcpSource}
              size={iconSize}
            />
          ) : (
            <IconDefinitionIcon
              icon={toolDisplay.icon}
              className="h-full! w-full! text-inherit opacity-[inherit]"
            />
          )}
        </span>
      )}
      <span
        ref={labelNode}
        className="min-w-0 flex-1 truncate text-inherit opacity-[inherit]"
        data-testid="agent-preview-tool-text"
      >
        {label}
      </span>
    </span>
  );
}

export default AgentPreviewToolLabel;
