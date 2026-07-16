import { describe, expect, it } from "vitest";
import {
  adapterSupportsSkillActivationTelemetry,
  adapterSupportsSkillSync,
} from "../services/activity.js";

describe("activity adapter skill capabilities", () => {
  it.each([
    "claude_local",
    "codex_local",
    "minimax_local",
    "opencode_local",
    "zai_local",
  ])("reports %s as activation-telemetry capable", (adapterType) => {
    expect(adapterSupportsSkillActivationTelemetry(adapterType)).toBe(true);
  });

  it.each([
    "acpx_local",
    "claude_local",
    "codex_local",
    "cursor",
    "gemini_local",
    "minimax_local",
    "opencode_local",
    "pi_local",
    "zai_local",
  ])("reports %s as skill-sync capable", (adapterType) => {
    expect(adapterSupportsSkillSync(adapterType)).toBe(true);
  });

  it.each([
    "http",
    "kimi_local",
    "process",
  ])("does not report %s as skill-capable", (adapterType) => {
    expect(adapterSupportsSkillSync(adapterType)).toBe(false);
    expect(adapterSupportsSkillActivationTelemetry(adapterType)).toBe(false);
  });
});
