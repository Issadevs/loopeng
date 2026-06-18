import { execFile } from "node:child_process";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z, type ZodTypeAny } from "zod";

import { bundleDirFor } from "../actions.js";
import { getProposal, loopengHome, readJson } from "../state.js";
import { readToolSpec } from "../toolgen.js";
import {
  type StepExec,
  type ToolArgs,
  type ToolParam,
  type ToolSpec,
  executeToolSpec,
} from "../toolspec.js";

/**
 * The loopeng-tools MCP server: the live end of the golden idea. It exposes every
 * installed loop that has a tool.json as a real, callable MCP tool, so a future
 * agent can run the captured workflow with one tool call. Each invocation
 * executes the spec's steps via execFile (no shell) with a hard timeout.
 *
 * The installed set is read once at server construction; newly approved tools
 * appear after a restart (loopeng mcp-tools), matching how MCP servers register
 * their tool list up front.
 */

const text = (s: string) => ({ type: "text" as const, text: s });

const STEP_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 256 * 1024;

/** Load every installed loop's tool.json (skipping loops without one). */
export function loadInstalledToolSpecs(): ToolSpec[] {
  const installed = readJson<string[]>(`${loopengHome()}/registry/installed.json`) ?? [];
  const specs: ToolSpec[] = [];
  const seen = new Set<string>();
  for (const id of installed) {
    const dir = bundleDirFor(getProposal(id), id);
    const spec = readToolSpec(dir, id);
    if (spec === undefined) {
      continue;
    }
    // Two loops should never expose the same MCP tool name; first wins.
    if (seen.has(spec.name)) {
      continue;
    }
    seen.add(spec.name);
    specs.push(spec);
  }
  return specs;
}

function zodForParam(param: ToolParam): ZodTypeAny {
  let schema: ZodTypeAny;
  switch (param.type) {
    case "number":
      schema = z.number();
      break;
    case "boolean":
      schema = z.boolean();
      break;
    case "string":
    default:
      schema = z.string();
      break;
  }
  schema = schema.describe(param.description);
  return param.required ? schema : schema.optional();
}

function inputSchema(spec: ToolSpec): Record<string, ZodTypeAny> {
  const shape: Record<string, ZodTypeAny> = {};
  for (const param of spec.parameters) {
    shape[param.name] = zodForParam(param);
  }
  return shape;
}

/** execFile-based step runner: no shell, with timeout and bounded output. */
function makeStepExec(): StepExec {
  return (cmd, args, opts) =>
    new Promise((resolve) => {
      execFile(
        cmd,
        args,
        {
          cwd: opts.cwd,
          timeout: STEP_TIMEOUT_MS,
          maxBuffer: MAX_OUTPUT_BYTES,
          windowsHide: true,
        },
        (error, stdout, stderr) => {
          const out = `${stdout ?? ""}${stderr ?? ""}`;
          if (error) {
            const code =
              typeof (error as NodeJS.ErrnoException).code === "number"
                ? ((error as unknown as { code: number }).code as number)
                : 1;
            const message = (error as NodeJS.ErrnoException).code
              ? `${out}${out ? "\n" : ""}${error.message}`
              : out;
            resolve({ code: code === 0 ? 1 : code, out: message });
            return;
          }
          resolve({ code: 0, out });
        },
      );
    });
}

export function createToolsServer(stepExec: StepExec = makeStepExec()): McpServer {
  const specs = loadInstalledToolSpecs();

  const server = new McpServer(
    { name: "loopeng-tools", version: "0.1.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "Callable tools synthesised by loopEng from the developer's own terminal workflows. " +
        "Each tool runs a captured sequence of commands so you can perform a routine task in one call. " +
        (specs.length === 0
          ? "No tools are installed yet — approve a proposal in loopEng to generate one."
          : `${specs.length} tool(s) available.`),
    },
  );

  if (specs.length === 0) {
    // A server with zero tools answers tools/list with "method not found",
    // which surfaces as an error in the host. Register a single help tool so
    // the server is always well-formed and the agent gets a useful hint.
    server.tool(
      "loopeng_tools_help",
      "Explains that loopEng has not captured any callable workflows yet.",
      async () => ({
        content: [
          text(
            "No workflows have been turned into tools yet. Approve a proposal in loopEng " +
              "(loopeng review) to generate a callable tool, then restart this server.",
          ),
        ],
      }),
    );
    return server;
  }

  for (const spec of specs) {
    server.tool(spec.name, spec.description, inputSchema(spec), async (args) => {
      try {
        const result = await executeToolSpec(spec, (args ?? {}) as ToolArgs, stepExec);
        const header = result.ok
          ? `✓ ${spec.name} completed (${result.results.length} step(s)).`
          : `✗ ${spec.name} failed at step ${result.results.length}.`;
        return {
          content: [text(`${header}\n\n${result.output}`)],
          isError: !result.ok,
        };
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        return { content: [text(`✗ ${spec.name} could not run: ${reason}`)], isError: true };
      }
    });
  }

  return server;
}

export async function runToolsServer(): Promise<void> {
  const server = createToolsServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
