/**
 * MCP Tool Interface and Base Implementation
 *
 * Defines the interface for MCP tools that agents can call
 * to interact with the workspace.
 */

import {
  Tool,
  ToolCall,
  ToolResult,
  ContentItem,
  ToolInputSchema,
  PropertySchema,
} from './protocol';

/**
 * Base interface for MCP tools
 */
export interface IMCPTool {
  /**
   * Get the tool definition
   */
  getDefinition(): Tool;

  /**
   * Execute the tool with the given arguments
   */
  execute(call: ToolCall): Promise<ToolResult>;
}

/**
 * Abstract base class for MCP tools
 */
export abstract class BaseMCPTool implements IMCPTool {
  protected name: string;
  protected description: string;
  protected inputSchema: ToolInputSchema;
  protected outputSchema?: Record<string, any>;
  protected metadata?: Record<string, any>;

  constructor(
    name?: string,
    description?: string,
    inputSchema?: ToolInputSchema,
    outputSchema?: Record<string, any>,
    metadata?: Record<string, any>,
  ) {
    this.name = name || '';
    this.description = description || '';
    this.inputSchema = inputSchema || { type: 'object' as const, properties: {}, required: [] };
    this.outputSchema = outputSchema;
    this.metadata = metadata;
  }

  getDefinition(): Tool {
    return {
      name: this.name,
      description: this.description,
      inputSchema: this.inputSchema,
      outputSchema: this.outputSchema,
      metadata: this.metadata,
    };
  }

  abstract execute(call: ToolCall): Promise<ToolResult>;

  /**
   * Helper to create a successful result
   */
  protected success(content: string, metadata?: Record<string, any>): ToolResult {
    return {
      content: [{ type: 'text', text: content }],
      metadata,
      isError: false,
    };
  }

  /**
   * Helper to create an error result
   */
  protected error(message: string, metadata?: Record<string, any>): ToolResult {
    return {
      content: [{ type: 'text', text: message }],
      metadata,
      isError: true,
    };
  }

  /**
   * Helper to create a result with multiple content items
   */
  protected result(
    content: ContentItem[],
    isError: boolean = false,
    metadata?: Record<string, any>,
  ): ToolResult {
    return {
      content,
      metadata,
      isError,
    };
  }
}

// Export alias for backward compatibility
export { BaseMCPTool as Tool };

/**
 * Helper to create a simple string property schema
 */
export function stringProperty(
  description: string,
  options?: { default?: string; enum?: string[] },
): PropertySchema {
  return {
    type: 'string',
    description,
    ...options,
  };
}

/**
 * Helper to create a number property schema
 */
export function numberProperty(
  description: string,
  options?: { default?: number; minimum?: number; maximum?: number },
): PropertySchema {
  return {
    type: 'number',
    description,
    ...options,
  };
}

/**
 * Helper to create a boolean property schema
 */
export function booleanProperty(
  description: string,
  options?: { default?: boolean },
): PropertySchema {
  return {
    type: 'boolean',
    description,
    ...options,
  };
}

/**
 * Helper to create an array property schema
 */
export function arrayProperty(
  description: string,
  itemType: string,
  options?: { default?: any[] },
): PropertySchema {
  return {
    type: 'array',
    description,
    items: { type: itemType },
    ...options,
  };
}

/**
 * Helper to create an input schema
 */
export function createInputSchema(
  properties: Record<string, PropertySchema>,
  required: string[] = [],
): ToolInputSchema {
  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  };
}
