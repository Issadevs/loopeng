export type ToolName = "claude-code" | "codex";

export interface SessionEvent {
  t: string;                       // ISO timestamp
  kind: "user_msg" | "command" | "tool_call" | "error";
  text?: string;                   // user_msg only
  name?: string;                   // command/tool_call only
  summary?: string;                // tool_call/error only
}

export interface SessionRecord {
  tool: ToolName;
  sessionId: string;
  startedAt: string;
  endedAt: string;
  cwd: string;
  repo?: string;
  branch?: string;
  events: SessionEvent[];
}

export type CandidateType = "recurring_task" | "babysitting" | "post_event"
  | "retry_storm" | "hygiene" | "cross_tool";

export interface Evidence { sessionId: string; events: number[]; }

export interface Candidate {
  id: string;                      // stable hash of pattern
  type: CandidateType;
  summary: string;
  evidence: Evidence[];
  occurrences: number;
  confidence: number;              // 0..1
  suggestedTool: ToolName;
  impactEstimate: string;          // e.g. "saves ~30 min/week"
}

export type ProposalStatus = "pending" | "approved" | "dismissed" | "snoozed";

export interface Proposal {
  candidate: Candidate;
  status: ProposalStatus;
  createdAt: string;
  snoozedUntil?: string;
  bundleDir?: string;              // set once generated
}

export interface BundleManifest {
  loopId: string;
  generatedAt: string;
  evidence: Evidence[];
  tool: ToolName;
  installedPaths: string[];        // every path written at install time
  uninstallNotes: string[];
}

export interface LoopEngConfig {
  companion: "auto" | "manual" | "off";
  dailyTokenCap: number;           // default 100000
  pollIntervalMin: number;         // default 15
  runnerCommand: string;           // command used for Claude Code inference — default "claude"
  runnerArgs: string[];            // args passed before the prompt — default ["-p"]
  runnerTimeoutMs: number;         // max engine runner duration — default 120000
  claudeProjectsDir: string;       // Claude Code transcripts root — default ~/.claude/projects
  codexSessionsDir: string;        // Codex sessions root — default ~/.codex/sessions
  // What loopEng pays attention to:
  //   "all"     — every Claude Code / Codex session on the machine
  //   "project" — only sessions whose cwd is the project loopEng runs in
  scope: "all" | "project";        // default "all"
  recentWindowHours: number;       // a session counts as active within this window — default 4
  scanMaxAttempts: number;         // LLM calls per scan (1 = no retry) — default 1
  scanMaxDigestChars: number;      // max digest text sent per scan — default 60000 (~15k tokens)
  eventsMaxBytes: number;          // rotate events.jsonl above this size — default 524288
  eventsKeepLines: number;         // lines kept after event log rotation — default 1000
  mcpToolStepTimeoutMs: number;    // timeout for generated MCP tool steps — default 120000
  mcpToolMaxOutputBytes: number;   // max stdout+stderr buffer for MCP tool steps — default 262144
  dashboardBusyTickMs: number;     // dashboard busy spinner cadence — default 333
  dashboardRefreshMs: number;      // dashboard data refresh cadence — default 5000
  watcherMarkerDebounceMs: number; // debounce for trigger marker changes — default 2000
}
