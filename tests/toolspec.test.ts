import { describe, expect, it, vi } from "vitest";
import {
  type StepExec,
  type ToolSpec,
  ToolSpecError,
  executeToolSpec,
  renderSteps,
  validateToolSpec,
} from "../src/toolspec.js";

const LOOP_ID = "cand-1";

function rawSpec(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "deploy_staging",
    description: "Deploy the current branch to staging.",
    parameters: [{ name: "branch", type: "string", description: "branch to deploy", required: true }],
    steps: [{ argv: ["git", "push", "origin", "${branch}"] }],
    ...overrides,
  };
}

describe("validateToolSpec", () => {
  it("accepts a well-formed spec and injects the loopId", () => {
    const spec = validateToolSpec(rawSpec(), LOOP_ID);
    expect(spec.loopId).toBe(LOOP_ID);
    expect(spec.name).toBe("deploy_staging");
    expect(spec.parameters).toHaveLength(1);
    expect(spec.steps[0].argv).toEqual(["git", "push", "origin", "${branch}"]);
  });

  it("rejects a non-object", () => {
    expect(() => validateToolSpec("nope", LOOP_ID)).toThrow(ToolSpecError);
    expect(() => validateToolSpec(null, LOOP_ID)).toThrow(/JSON object/);
  });

  it("rejects an invalid tool name", () => {
    expect(() => validateToolSpec(rawSpec({ name: "Bad-Name" }), LOOP_ID)).toThrow(/name must match/);
    expect(() => validateToolSpec(rawSpec({ name: "ab" }), LOOP_ID)).toThrow(/name must match/);
  });

  it("rejects an empty description", () => {
    expect(() => validateToolSpec(rawSpec({ description: "  " }), LOOP_ID)).toThrow(/description/);
  });

  it("rejects a bad parameter type and name", () => {
    expect(() =>
      validateToolSpec(rawSpec({ parameters: [{ name: "x", type: "date", description: "d", required: true }] }), LOOP_ID),
    ).toThrow(/type must be one of/);
    expect(() =>
      validateToolSpec(rawSpec({ parameters: [{ name: "1x", type: "string", description: "d", required: true }] }), LOOP_ID),
    ).toThrow(/name must match/);
  });

  it("rejects duplicate parameter names", () => {
    const params = [
      { name: "x", type: "string", description: "d", required: true },
      { name: "x", type: "number", description: "d", required: true },
    ];
    expect(() => validateToolSpec(rawSpec({ parameters: params }), LOOP_ID)).toThrow(/duplicate/);
  });

  it("requires a non-empty steps array", () => {
    expect(() => validateToolSpec(rawSpec({ steps: [] }), LOOP_ID)).toThrow(/non-empty array/);
  });

  it("rejects an empty argv", () => {
    expect(() => validateToolSpec(rawSpec({ steps: [{ argv: [] }] }), LOOP_ID)).toThrow(/non-empty array/);
  });

  it("rejects a placeholder in the command position (argv[0])", () => {
    const spec = rawSpec({ steps: [{ argv: ["${branch}", "push"] }] });
    expect(() => validateToolSpec(spec, LOOP_ID)).toThrow(/argv\[0\].*placeholder/);
  });

  it("rejects shells/interpreters as the command (incl. paths and .exe)", () => {
    for (const cmd of ["bash", "/bin/sh", "ZSH", "python3", "node", "env", "Bash.exe"]) {
      const spec = rawSpec({ parameters: [], steps: [{ argv: [cmd, "-c", "echo hi"] }] });
      expect(() => validateToolSpec(spec, LOOP_ID)).toThrow(/not allowed/);
    }
    // Ordinary tools are still fine.
    expect(() =>
      validateToolSpec(rawSpec({ parameters: [], steps: [{ argv: ["git", "status"] }] }), LOOP_ID)
    ).not.toThrow();
  });

  it("rejects a placeholder referencing an unknown parameter", () => {
    const spec = rawSpec({ steps: [{ argv: ["git", "push", "${nope}"] }] });
    expect(() => validateToolSpec(spec, LOOP_ID)).toThrow(/unknown parameter "nope"/);
  });

  it("rejects a placeholder referencing an optional parameter", () => {
    const spec = rawSpec({
      parameters: [{ name: "branch", type: "string", description: "d", required: false }],
      steps: [{ argv: ["git", "push", "${branch}"] }],
    });
    expect(() => validateToolSpec(spec, LOOP_ID)).toThrow(/must be required/);
  });

  it("rejects more than the max number of steps", () => {
    const steps = Array.from({ length: 21 }, () => ({ argv: ["echo", "hi"] }));
    expect(() => validateToolSpec(rawSpec({ steps, parameters: [] }), LOOP_ID)).toThrow(/at most 20/);
  });

  it("accepts an optional workingDir but rejects an empty one", () => {
    expect(validateToolSpec(rawSpec({ workingDir: "/tmp/app" }), LOOP_ID).workingDir).toBe("/tmp/app");
    expect(() => validateToolSpec(rawSpec({ workingDir: "" }), LOOP_ID)).toThrow(/workingDir/);
  });
});

describe("renderSteps", () => {
  function spec(): ToolSpec {
    return validateToolSpec(
      rawSpec({
        parameters: [
          { name: "branch", type: "string", description: "d", required: true },
          { name: "count", type: "number", description: "d", required: true },
          { name: "force", type: "boolean", description: "d", required: true },
        ],
        steps: [
          { argv: ["git", "checkout", "${branch}"] },
          { argv: ["deploy", "--n=${count}", "--force=${force}"] },
        ],
      }),
      LOOP_ID,
    );
  }

  it("substitutes string, number and boolean args literally", () => {
    const rendered = renderSteps(spec(), { branch: "main", count: 3, force: true });
    expect(rendered).toEqual([
      ["git", "checkout", "main"],
      ["deploy", "--n=3", "--force=true"],
    ]);
  });

  it("throws on a missing required arg", () => {
    expect(() => renderSteps(spec(), { count: 3, force: true })).toThrow(/missing required argument "branch"/);
  });

  it("throws on an ill-typed arg", () => {
    expect(() => renderSteps(spec(), { branch: "main", count: "three" as unknown as number, force: true })).toThrow(
      /must be a finite number/,
    );
  });

  it("does not shell-interpret a malicious value — it stays one literal token", () => {
    const rendered = renderSteps(spec(), { branch: "main; rm -rf /", count: 1, force: false });
    expect(rendered[0]).toEqual(["git", "checkout", "main; rm -rf /"]);
  });
});

describe("executeToolSpec", () => {
  function twoStep(): ToolSpec {
    return validateToolSpec(
      rawSpec({
        parameters: [{ name: "branch", type: "string", description: "d", required: true }],
        steps: [
          { argv: ["git", "checkout", "${branch}"] },
          { argv: ["npm", "test"] },
        ],
      }),
      LOOP_ID,
    );
  }

  it("runs every step in order when each succeeds", async () => {
    const exec = vi.fn<Parameters<StepExec>, ReturnType<StepExec>>(async () => ({ code: 0, out: "ok" }));
    const result = await executeToolSpec(twoStep(), { branch: "main" }, exec);

    expect(result.ok).toBe(true);
    expect(exec).toHaveBeenCalledTimes(2);
    expect(exec.mock.calls[0]).toEqual(["git", ["checkout", "main"], { cwd: undefined }]);
    expect(exec.mock.calls[1]).toEqual(["npm", ["test"], { cwd: undefined }]);
  });

  it("stops at the first failing step", async () => {
    const exec = vi.fn<Parameters<StepExec>, ReturnType<StepExec>>(async () => ({ code: 1, out: "boom" }));
    const result = await executeToolSpec(twoStep(), { branch: "main" }, exec);

    expect(result.ok).toBe(false);
    expect(exec).toHaveBeenCalledTimes(1);
    expect(result.results).toHaveLength(1);
    expect(result.output).toContain("(exit 1)");
  });

  it("treats a thrown exec as a failed step (exit 127)", async () => {
    const exec = vi.fn<Parameters<StepExec>, ReturnType<StepExec>>(async () => {
      throw new Error("ENOENT");
    });
    const result = await executeToolSpec(twoStep(), { branch: "main" }, exec);

    expect(result.ok).toBe(false);
    expect(result.results[0].code).toBe(127);
    expect(result.results[0].out).toContain("ENOENT");
  });

  it("passes workingDir through to exec", async () => {
    const spec = validateToolSpec(rawSpec({ steps: [{ argv: ["ls"] }], parameters: [], workingDir: "/tmp/app" }), LOOP_ID);
    const exec = vi.fn<Parameters<StepExec>, ReturnType<StepExec>>(async () => ({ code: 0, out: "" }));
    await executeToolSpec(spec, {}, exec);
    expect(exec.mock.calls[0][2]).toEqual({ cwd: "/tmp/app" });
  });
});
