/**
 * tool-results.ts — how every bmail tool answers.
 *
 * Two shapes and nothing else: a success carrying one concise JSON object,
 * and an MCP tool error (isError: true) carrying a helpful message. The
 * `runTool` wrapper is what keeps the server alive: a throwing operation
 * becomes an error RESULT for the model to read, never a crashed process.
 */

// The result shape the MCP SDK expects from a tool callback.
export interface ToolResult {
  [key: string]: unknown;
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

/** Wrap a JSON-serializable payload as a successful tool result. */
export function jsonResult(payload: unknown): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  };
}

/** Wrap a message as an MCP tool error (the model sees it; nothing crashes). */
export function errorResult(message: string): ToolResult {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  };
}

/** Run a tool body, converting any thrown error into an MCP tool error. */
export async function runTool(body: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await body();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResult(message);
  }
}
