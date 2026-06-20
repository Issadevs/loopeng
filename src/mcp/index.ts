import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import {
  type CliDeps,
  bundleDirFor,
  approveAction,
  dismissAction,
  snoozeAction,
  scanAction,
  uninstallAction,
} from "../actions.js";
import {
  listProposals,
  getProposal,
  loopengHome,
  readJson,
  loadConfig,
} from "../state.js";
import { readEvents } from "../events.js";
import { CLI_BIN, VERSION } from "../constants.js";
import { readBundleManifest, readTrigger } from "../installers/shared.js";

// ── Helpers ────────────────────────────────────────────────────────────────

const text = (s: string) => ({ type: "text" as const, text: s });

const notFound = (id: string) => ({ content: [text(`Proposal "${id}" not found.`)] });

function spendLedger(): Record<string, number> {
  return readJson<Record<string, number>>(`${loopengHome()}/log/spend.json`) ?? {};
}

function pendingCount(): number {
  return listProposals().filter((p) => p.status === "pending").length;
}

// ── Server factory ─────────────────────────────────────────────────────────

export function createMcpServer(deps: CliDeps): McpServer {
  const server = new McpServer(
    { name: CLI_BIN, version: VERSION },
    {
      capabilities: { tools: {}, resources: {} },
      instructions:
        "MCP server for loopEng — a terminal meta-agent that watches how you work and writes automation loops. Use the available tools to inspect, approve, dismiss, or snooze proposals, trigger scans, list installed loops, and check status.",
    },
  );

  /* ── Tools ─────────────────────────────────────────────────────────────── */

  server.tool(
    "proposals_list",
    "List all loop proposals with status, confidence, and impact estimate.",
    async () => {
      const proposals = listProposals();
      if (proposals.length === 0) return { content: [text("No proposals.")] };
      return {
        content: [
          text(
            proposals
              .map(
                (p) =>
                  `[${p.status}] ${p.candidate.id} — ${p.candidate.summary} (confidence: ${p.candidate.confidence}, impact: ${p.candidate.impactEstimate})`,
              )
              .join("\n"),
          ),
        ],
      };
    },
  );

  server.tool(
    "proposals_get",
    "Get details of a specific proposal by ID.",
    { id: z.string() },
    ({ id }) => {
      const p = getProposal(id);
      if (!p) return notFound(id);
      const lines = [
        `ID: ${p.candidate.id}`,
        `Status: ${p.status}`,
        `Type: ${p.candidate.type}`,
        `Summary: ${p.candidate.summary}`,
        `Confidence: ${p.candidate.confidence}`,
        `Occurrences: ${p.candidate.occurrences}`,
        `Impact: ${p.candidate.impactEstimate}`,
        `Suggested tool: ${p.candidate.suggestedTool}`,
        `Created: ${p.createdAt}`,
        ...(p.snoozedUntil ? [`Snoozed until: ${p.snoozedUntil}`] : []),
        ...(p.bundleDir ? [`Bundle: ${p.bundleDir}`] : []),
        ...p.candidate.evidence.flatMap((e, i) => [
          `Evidence #${i + 1}: session ${e.sessionId}, events [${e.events.join(", ")}]`,
        ]),
      ];
      return { content: [text(lines.join("\n"))] };
    },
  );

  server.tool(
    "proposals_approve",
    "Approve a pending proposal — generates a bundle and installs the automation loop.",
    { id: z.string() },
    async ({ id }) => {
      const p = getProposal(id);
      if (!p) return notFound(id);
      if (p.status !== "pending") {
        return { content: [text(`Proposal "${id}" is ${p.status}, not pending.`)] };
      }
      const r = await approveAction(deps, p);
      if (!r.ok) return { content: [text(`Failed: ${r.reason}`)], isError: true };
      return { content: [text(`Approved and installed "${id}".`)] };
    },
  );

  server.tool(
    "proposals_dismiss",
    "Dismiss a proposal so it won't be suggested again.",
    { id: z.string() },
    async ({ id }) => {
      const p = getProposal(id);
      if (!p) return notFound(id);
      const r = await dismissAction(deps, p);
      if (!r.ok) return { content: [text(`Failed: ${r.reason}`)], isError: true };
      return { content: [text(`Dismissed "${id}".`)] };
    },
  );

  server.tool(
    "proposals_snooze",
    "Snooze a proposal for 7 days.",
    { id: z.string() },
    async ({ id }) => {
      const p = getProposal(id);
      if (!p) return notFound(id);
      const r = await snoozeAction(deps, p);
      if (!r.ok) return { content: [text(`Failed: ${r.reason}`)], isError: true };
      return { content: [text(`Snoozed "${id}" for 7 days.`)] };
    },
  );

  server.tool(
    "scan",
    "Trigger a scan of recent digests to discover new automation loop candidates.",
    async () => {
      const r = await scanAction(deps);
      if (!r.ok) return { content: [text(`Scan failed: ${r.reason}`)], isError: true };
      return { content: [text("Scan complete.")] };
    },
  );

  server.tool(
    "loops_list",
    "List all installed automation loops with their trigger kind and target tool.",
    async () => {
      const installed =
        readJson<string[]>(`${loopengHome()}/registry/installed.json`) ?? [];
      if (installed.length === 0) {
        return { content: [text("No loops installed.")] };
      }
      const lines = installed.map((id) => {
        try {
          const dir = bundleDirFor(getProposal(id), id);
          const manifest = readBundleManifest(dir);
          const trigger = readTrigger(dir);
          return `${manifest.loopId}  ${manifest.tool}  ${trigger.kind}  generated ${manifest.generatedAt}`;
        } catch {
          return `${id}  (bundle unreadable)`;
        }
      });
      return { content: [text(lines.join("\n"))] };
    },
  );

  server.tool(
    "loops_uninstall",
    "Uninstall an automation loop by its ID. Removes the bundle, trigger, and registry entry.",
    { id: z.string() },
    async ({ id }) => {
      const r = await uninstallAction(deps, id);
      if (!r.ok) return { content: [text(`Failed: ${r.reason}`)], isError: true };
      return { content: [text(`Uninstalled "${id}".`)] };
    },
  );

  server.tool(
    "events",
    "Show the most recent loopeng events (scan, approve, dismiss, etc.).",
    { limit: z.number().optional().default(50) },
    async ({ limit }) => {
      const events = readEvents(limit);
      if (events.length === 0) return { content: [text("No events.")] };
      return {
        content: [
          text(events.map((e) => `[${e.t}] ${e.kind}: ${e.msg}`).join("\n")),
        ],
      };
    },
  );

  server.tool(
    "status",
    "Show loopeng daemon status, today's token spend, and pending proposal count.",
    async () => {
      const config = loadConfig();
      const ledger = spendLedger();
      const today = new Date().toISOString().slice(0, 10);
      return {
        content: [
          text(
            [
              `Companion: ${config.companion}`,
              `Daily token cap: ${config.dailyTokenCap}`,
              `Poll interval: ${config.pollIntervalMin} min`,
              `Today's spend: ${ledger[today] ?? 0} / ${config.dailyTokenCap} tokens`,
              `Pending proposals: ${pendingCount()}`,
            ].join("\n"),
          ),
        ],
      };
    },
  );

  /* ── Resources ─────────────────────────────────────────────────────────── */

  server.resource(
    "proposal",
    new ResourceTemplate("loopeng://proposals/{id}", {
      list: async () => {
        const proposals = listProposals();
        return {
          resources: proposals.map((p) => ({
            uri: `loopeng://proposals/${p.candidate.id}`,
            name: p.candidate.id,
            description: `[${p.status}] ${p.candidate.summary}`,
          })),
        };
      },
    }),
    async (uri, variables) => {
      const id = Array.isArray(variables.id) ? variables.id[0] : variables.id;
      const p = getProposal(id);
      if (!p) {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify({ error: `Proposal "${id}" not found.` }),
            },
          ],
        };
      }
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(p, null, 2),
          },
        ],
      };
    },
  );

  server.resource(
    "events",
    "loopeng://events",
    async (uri) => {
      const events = readEvents(50);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(events, null, 2),
          },
        ],
      };
    },
  );

  server.resource(
    "status",
    "loopeng://status",
    async (uri) => {
      const config = loadConfig();
      const ledger = spendLedger();
      const today = new Date().toISOString().slice(0, 10);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(
              {
                config,
                spendToday: ledger[today] ?? 0,
                pendingProposals: pendingCount(),
                proposals: listProposals().map((p) => ({
                  id: p.candidate.id,
                  status: p.status,
                  summary: p.candidate.summary,
                })),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  return server;
}

// ── Entry point ────────────────────────────────────────────────────────────

export async function runMcpServer(deps: CliDeps): Promise<void> {
  // Route CLI output to stderr so it never pollutes the JSON-RPC stream.
  const server = createMcpServer({ ...deps, out: (s) => process.stderr.write(`${s}\n`) });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
