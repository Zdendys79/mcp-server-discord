// Shared types for MCP tool modules

/** MCP tool response content item */
export interface ToolContent {
  type: "text";
  text: string;
}

/** MCP tool response - uses index signature for SDK compatibility */
export interface ToolResponse {
  [key: string]: unknown;
  content: ToolContent[];
  isError?: boolean;
}

/** MCP tool definition (JSON schema for input) */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/** Tool handler function */
export type ToolHandler = (
  args: Record<string, unknown>
) => Promise<ToolResponse>;

/** A complete tool module entry: definition + handler */
export interface ToolEntry {
  definition: ToolDefinition;
  handler: ToolHandler;
}

/** Helper: create a text response */
export function textResponse(text: string, isError = false): ToolResponse {
  return {
    content: [{ type: "text" as const, text }],
    ...(isError ? { isError: true } : {}),
  };
}

/** Helper: create a JSON response */
export function jsonResponse(data: unknown, isError = false): ToolResponse {
  return textResponse(JSON.stringify(data, null, 2), isError);
}

/** Helper: create an error response */
export function errorResponse(message: string): ToolResponse {
  return textResponse(`Error: ${message}`, true);
}
