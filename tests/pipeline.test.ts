import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PipelineError,
  clearPipelineState,
  collectPipeline,
  draftPipelinePrompt,
  formatPipeline,
  parseDraftedPipeline,
  listPipelineIds,
  loadPipeline,
  loadPipelineState,
  removePipeline,
  runPipeline,
  savePipeline,
  savePipelineState,
  validatePipeline,
  type Pipeline,
  type PipelineDeps,
  type PipelinePhase,
  type PipelineRunState
} from "../src/pipeline.js";

function phase(name: string, over: Partial<PipelinePhase> = {}): PipelinePhase {
  return { name, instruction: `do ${name}`, ...over };
}

function pipeline(over: Partial<Pipeline> = {}): Pipeline {
  return { id: "ship", phases: [phase("implement"), phase("pr")], ...over };
}

// A recording harness over the injected deps.
function harness(opts: {
  agent?: PipelineDeps["agent"];
  gate?: PipelineDeps["gate"];
}) {
  const saved: PipelineRunState[] = [];
  let cleared = false;
  const agentCalls: string[] = [];
  const baseAgent: PipelineDeps["agent"] = opts.agent ?? (async () => ({ ok: true, output: "done" }));
  const deps: PipelineDeps = {
    agent: async (instruction, p) => {
      agentCalls.push(instruction); // record exactly once per phase attempt
      return baseAgent(instruction, p);
    },
    gate: opts.gate ?? (async () => ({ code: 0, out: "" })),
    saveState: (s) => saved.push(s),
    clearState: () => {
      cleared = true;
    },
    log: () => {}
  };
  return { deps, saved, agentCalls, isCleared: () => cleared };
}

describe("validatePipeline", () => {
  it("accepts a well-formed pipeline", () => {
    const p = validatePipeline(
      {
        description: "ship a feature",
        phases: [
          { name: "implement", instruction: "build it" },
          { name: "test", instruction: "run tests", gate: ["npm", "test"], maxAttempts: 3 }
        ]
      },
      "ship-feature"
    );
    expect(p.id).toBe("ship-feature");
    expect(p.phases).toHaveLength(2);
    expect(p.phases[1].gate).toEqual(["npm", "test"]);
    expect(p.phases[1].maxAttempts).toBe(3);
  });

  it("rejects bad ids, empty phases, bad names, and missing instructions", () => {
    expect(() => validatePipeline({ phases: [phase("a")] }, "Bad Id")).toThrow(/id/);
    expect(() => validatePipeline({ phases: [] }, "x")).toThrow(/non-empty array/);
    expect(() => validatePipeline({ phases: [{ name: "bad name", instruction: "x" }] }, "x")).toThrow(/name/);
    expect(() => validatePipeline({ phases: [{ name: "ok", instruction: "" }] }, "x")).toThrow(/instruction/);
  });

  it("rejects a shell/interpreter as a gate command", () => {
    expect(() =>
      validatePipeline(
        { phases: [{ name: "t", instruction: "x", gate: ["bash", "-c", "rm -rf /"] }] },
        "x"
      )
    ).toThrow(/not allowed/);
    expect(() => validatePipeline({ phases: [{ name: "t", instruction: "x", gate: [] }] }, "x")).toThrow(
      /non-empty array/
    );
  });

  it("rejects an out-of-range maxAttempts", () => {
    expect(() =>
      validatePipeline({ phases: [{ name: "t", instruction: "x", maxAttempts: 0 }] }, "x")
    ).toThrow(/maxAttempts/);
  });

  it("keeps workingDir inside the current workspace", () => {
    expect(
      validatePipeline({ workingDir: "packages/api", phases: [phase("a")] }, "x").workingDir
    ).toBe(join("packages", "api"));

    expect(() => validatePipeline({ workingDir: "/tmp", phases: [phase("a")] }, "x")).toThrow(/workingDir/);
    expect(() => validatePipeline({ workingDir: "../outside", phases: [phase("a")] }, "x")).toThrow(
      /workingDir/
    );
    expect(() => validatePipeline({ workingDir: "packages/../../outside", phases: [phase("a")] }, "x")).toThrow(
      /workingDir/
    );
  });

  it("fills the default maxAttempts and honors injected limits", () => {
    // Default-filled when omitted.
    const p = validatePipeline({ phases: [phase("a")] }, "x");
    expect(p.phases[0].maxAttempts).toBe(1);

    // Custom limits are enforced: tighter caps reject what defaults allowed.
    const limits = {
      maxPhases: 1,
      maxInstructionChars: 8000,
      maxGateArgv: 32,
      maxAttempts: 2,
      defaultMaxAttempts: 2
    };
    expect(() => validatePipeline({ phases: [phase("a"), phase("b")] }, "x", limits)).toThrow(
      /more than 1 phases/
    );
    expect(() =>
      validatePipeline({ phases: [{ name: "a", instruction: "x", maxAttempts: 3 }] }, "x", limits)
    ).toThrow(/1\.\.2/);
    // defaultMaxAttempts from the injected limits is applied.
    expect(validatePipeline({ phases: [phase("a")] }, "x", limits).phases[0].maxAttempts).toBe(2);
  });
});

describe("runPipeline", () => {
  it("runs every phase and clears state on success", async () => {
    const h = harness({});
    const result = await runPipeline(pipeline(), h.deps);

    expect(result.ok).toBe(true);
    expect(result.completed).toEqual(["implement", "pr"]);
    expect(h.isCleared()).toBe(true);
    expect(h.saved.map((s) => s.phaseIndex)).toEqual([1, 2]); // advanced after each phase
  });

  it("retries a failing gate with feedback, then advances", async () => {
    let gateCalls = 0;
    const h = harness({
      gate: async () => {
        gateCalls += 1;
        return gateCalls === 1 ? { code: 1, out: "2 tests failed" } : { code: 0, out: "" };
      }
    });
    const p = pipeline({ phases: [phase("test", { gate: ["npm", "test"], maxAttempts: 3 })] });

    const result = await runPipeline(p, h.deps);

    expect(result.ok).toBe(true);
    expect(gateCalls).toBe(2);
    // The 2nd agent attempt was given the gate failure to fix.
    expect(h.agentCalls[1]).toContain("2 tests failed");
    expect(h.agentCalls[1]).toContain("npm test");
  });

  it("stops when a gate keeps failing past maxAttempts", async () => {
    const h = harness({ gate: async () => ({ code: 1, out: "still red" }) });
    const p = pipeline({ phases: [phase("test", { gate: ["npm", "test"], maxAttempts: 2 }), phase("pr")] });

    const result = await runPipeline(p, h.deps);

    expect(result.ok).toBe(false);
    expect(result.stoppedAt).toBe("test");
    expect(result.completed).toEqual([]);
    expect(h.isCleared()).toBe(false);
    expect(h.saved.at(-1)).toEqual({ phaseIndex: 0 }); // resume re-runs the stuck phase
  });

  it("stops on an agent error", async () => {
    const h = harness({ agent: async () => ({ ok: false, output: "claude crashed" }) });
    const result = await runPipeline(pipeline(), h.deps);

    expect(result.ok).toBe(false);
    expect(result.stoppedAt).toBe("implement");
    expect(result.reason).toContain("claude crashed");
  });

  it("resumes from a saved phase index", async () => {
    const h = harness({});
    const p = pipeline({ phases: [phase("implement"), phase("test"), phase("pr")] });

    const result = await runPipeline(p, h.deps, { phaseIndex: 2 });

    expect(result.ok).toBe(true);
    expect(result.completed).toEqual(["pr"]); // only the remaining phase ran
    expect(h.agentCalls).toHaveLength(1);
  });
});

describe("collectPipeline (interactive)", () => {
  it("builds and validates a pipeline from scripted answers", async () => {
    const answers = [
      "ship it", // description
      "implement", "build it", "", "", // phase 1: name, instruction, gate(none), attempts(none)
      "test", "run tests", "npm test", "2", // phase 2: with gate + attempts
      "" // blank name → finish
    ];
    let i = 0;
    const ask = async () => answers[i++] ?? "";

    const p = await collectPipeline(ask, "ship");

    expect(p.description).toBe("ship it");
    expect(p.phases.map((x) => x.name)).toEqual(["implement", "test"]);
    expect(p.phases[0].maxAttempts).toBe(1); // default filled
    expect(p.phases[1].gate).toEqual(["npm", "test"]);
    expect(p.phases[1].maxAttempts).toBe(2);
  });
});

describe("AI drafting", () => {
  it("builds a prompt with the description, hints, and limits", () => {
    const prompt = draftPipelinePrompt({
      id: "ship",
      description: "build then test until green",
      hints: "package.json scripts:\n- test: `npm run test`"
    });
    expect(prompt).toContain("build then test until green");
    expect(prompt).toContain("npm run test");
    expect(prompt).toContain("ONE AT A TIME");
  });

  it("parses a JSON pipeline out of a chatty model response", () => {
    const json =
      '{"description":"d","phases":[{"name":"test","instruction":"run tests","gate":["npm","test"]}]}';
    const p = parseDraftedPipeline("Sure! Here it is:\n```json\n" + json + "\n```", "ship");
    expect(p.phases[0].gate).toEqual(["npm", "test"]);
    expect(p.phases[0].maxAttempts).toBe(1); // default filled
  });

  it("throws when the model returns no JSON object", () => {
    expect(() => parseDraftedPipeline("I cannot help with that.", "ship")).toThrow();
  });
});

describe("formatPipeline", () => {
  it("renders id, description, phases, and gates", () => {
    const p = pipeline({
      id: "ship",
      description: "x",
      phases: [phase("test", { gate: ["npm", "test"], maxAttempts: 3 })]
    });
    const out = formatPipeline(p).join("\n");
    expect(out).toContain("ship — x");
    expect(out).toContain("1. test");
    expect(out).toContain("gate: npm test");
    expect(out).toContain("up to 3 attempts");
  });
});

describe("pipeline persistence", () => {
  let home: string;
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "loopeng-pipe-"));
    process.env.LOOPENG_HOME = home;
  });
  afterEach(async () => {
    delete process.env.LOOPENG_HOME;
    await rm(home, { recursive: true, force: true });
  });

  it("round-trips a spec and tracks/clears run state, excluding state files from the list", () => {
    savePipeline(pipeline({ id: "ship" }));
    expect(loadPipeline("ship")?.phases).toHaveLength(2);

    savePipelineState("ship", { phaseIndex: 1 });
    expect(loadPipelineState("ship")).toEqual({ phaseIndex: 1 });
    expect(listPipelineIds()).toEqual(["ship"]); // ship.state.json not listed as a pipeline

    clearPipelineState("ship");
    expect(loadPipelineState("ship")).toEqual({ phaseIndex: 0 }); // back to the start
  });

  it("loadPipeline returns undefined for an unknown id", () => {
    expect(loadPipeline("nope")).toBeUndefined();
  });

  it("loadPipeline returns undefined (never throws) for a spec over the given limits", () => {
    savePipeline(pipeline({ id: "big", phases: [phase("a"), phase("b")] }));
    // A tightened limit makes the stored 2-phase spec invalid — must not throw.
    const tight = {
      maxPhases: 1,
      maxInstructionChars: 8000,
      maxGateArgv: 32,
      maxAttempts: 10,
      defaultMaxAttempts: 1
    };
    expect(loadPipeline("big", tight)).toBeUndefined();
    expect(loadPipeline("big")).toBeDefined(); // still loads under default limits
  });

  it("removePipeline deletes the spec and state", () => {
    savePipeline(pipeline({ id: "gone" }));
    savePipelineState("gone", { phaseIndex: 1 });
    expect(removePipeline("gone")).toBe(true);
    expect(loadPipeline("gone")).toBeUndefined();
    expect(listPipelineIds()).not.toContain("gone");
    expect(removePipeline("gone")).toBe(false); // already gone
  });

  it("surfaces a validation error type", () => {
    expect(() => validatePipeline({ phases: [] }, "x")).toThrow(PipelineError);
  });
});
