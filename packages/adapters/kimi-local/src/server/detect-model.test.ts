import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { models } from "../index.js";
import { detectModel, hasKimiTerminalResult, kimiDefinition } from "./index.js";

describe("kimi_local server adapter", () => {
  const originalKimiModel = process.env.KIMI_MODEL;

  afterEach(() => {
    if (originalKimiModel === undefined) delete process.env.KIMI_MODEL;
    else process.env.KIMI_MODEL = originalKimiModel;
  });

  it("detects the configured model from Kimi env", async () => {
    process.env.KIMI_MODEL = "kimi-k2-0711-preview";

    await expect(detectModel()).resolves.toMatchObject({
      model: "kimi-k2-0711-preview",
      provider: "kimi",
      source: "env:KIMI_MODEL",
    });
  });

  it("prefers the executable default_model from Kimi config over nested provider aliases", async () => {
    // Inject a deterministic config instead of reading the developer's real
    // ~/.kimi config, which made this assertion machine-dependent.
    const config = JSON.stringify({
      default_model: "kimi-code/kimi-for-coding",
      providers: { moonshot: { model: "kimi-k2-0711-preview" } },
    });
    const configFile = path.join(".kimi", "config.json");

    await expect(detectModel({
      env: {},
      homeDir: path.join(path.sep, "home", "kimi-test"),
      readFile: async (filePath: string) => {
        if (filePath.endsWith(configFile)) return config;
        throw new Error(`unexpected read: ${filePath}`);
      },
    })).resolves.toMatchObject({
      model: "kimi-code/kimi-for-coding",
      provider: "kimi",
    });
  });

  it("builds the non-interactive Kimi command without permission flags", () => {
    // `--prompt` cannot be combined with `--yolo`/`--auto`/`--plan`; prompt mode
    // already auto-approves, so dangerouslySkipPermissions must not add a flag.
    expect(kimiDefinition.buildArgs({
      prompt: "do work",
      model: "kimi-k2-0711-preview",
      extraArgs: ["--debug"],
      config: { dangerouslySkipPermissions: true },
      runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
    })).toEqual([
      "--output-format",
      "stream-json",
      "--model",
      "kimi-k2-0711-preview",
      "--debug",
      "--prompt",
      "do work",
    ]);
  });

  it("resumes the saved Kimi session in non-interactive prompt mode", () => {
    expect(kimiDefinition.buildArgs({
      prompt: "continue work",
      model: "auto",
      extraArgs: [],
      config: {},
      runtime: {
        sessionId: "session_123",
        sessionParams: { sessionId: "session_123" },
        sessionDisplayId: "session_123",
        taskKey: "task-1",
      },
    })).toEqual([
      "--output-format",
      "stream-json",
      "--session",
      "session_123",
      "--prompt",
      "continue work",
    ]);
  });

  it("does not pass unsupported Paperclip skill directory flags to Kimi", () => {
    expect(kimiDefinition.buildArgs({
      prompt: "use skills",
      model: "kimi-code/kimi-for-coding",
      extraArgs: ["--debug", "--skills-dir", "C:\\configured-skills", "--skills-dir=D:\\more-skills"],
      config: {
        paperclipRuntimeSkills: [
          { key: "company/caveman", runtimeName: "caveman", source: path.join("C:\\skills", "caveman") },
          { key: "company/paperclip", runtimeName: "paperclip", source: path.join("C:\\skills", "paperclip") },
          { key: "company/memory", runtimeName: "memory", source: path.join("D:\\other", "memory") },
          { key: "invalid", runtimeName: "invalid", source: "" },
        ],
      },
      runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
    })).toEqual([
      "--output-format",
      "stream-json",
      "--model",
      "kimi-code/kimi-for-coding",
      "--debug",
      "--prompt",
      "use skills",
    ]);
  });

  it("extracts Kimi session resume hints from stdout", async () => {
    const result = await kimiDefinition.extractSessionParams?.({
      stdout: [
        JSON.stringify({ role: "assistant", content: "done" }),
        JSON.stringify({
          role: "meta",
          type: "session.resume_hint",
          session_id: "session_abc",
          command: "kimi -r session_abc",
        }),
      ].join("\n"),
      stderr: "",
      cwd: "/repo",
      runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
    });

    expect(result).toEqual({ sessionId: "session_abc", cwd: "/repo" });
  });

  it("does not treat non-terminal assistant narration as a complete Kimi result", () => {
    expect(hasKimiTerminalResult({
      stdout: [
        JSON.stringify({
          role: "assistant",
          content: [{ type: "text", text: "I will inspect the repo first." }],
        }),
      ].join("\n"),
      stderr: "",
    })).toBe(false);
  });

  it("treats explicit Kimi terminal events as complete results", () => {
    expect(hasKimiTerminalResult({
      stdout: [
        JSON.stringify({
          role: "assistant",
          content: [{ type: "text", text: "done" }],
          stop_reason: "end_turn",
        }),
      ].join("\n"),
      stderr: "",
    })).toBe(true);

    expect(hasKimiTerminalResult({
      stdout: [
        JSON.stringify({
          role: "meta",
          type: "session.resume_hint",
          session_id: "session_abc",
        }),
      ].join("\n"),
      stderr: "",
    })).toBe(true);
  });

  it("lists the local coding model detected by current Kimi config", () => {
    expect(models.map((model) => model.id)).toContain("kimi-code/kimi-for-coding");
  });
});
