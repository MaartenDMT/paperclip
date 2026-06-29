import { describe, expect, it } from "vitest";
import { normalizeZaiModelId } from "./index.js";

describe("zai_local server adapter", () => {
  it("normalizes only the supported Z.AI coding models", () => {
    expect(normalizeZaiModelId("4.7")).toBe("zai-coding-plan/glm-4.7");
    expect(normalizeZaiModelId("4.5air")).toBe("zai-coding-plan/glm-4.5-air");
    expect(normalizeZaiModelId("glm-4.5-air")).toBe("zai-coding-plan/glm-4.5-air");
    expect(normalizeZaiModelId("glm-5-turbo")).toBe("zai-coding-plan/glm-5-turbo");
    expect(normalizeZaiModelId("5.1")).toBe("zai-coding-plan/glm-5.1");
    expect(normalizeZaiModelId("5.2")).toBe("zai-coding-plan/glm-5.2");
    expect(normalizeZaiModelId("5v-turbo")).toBe("zai-coding-plan/glm-5v-turbo");
    expect(() => normalizeZaiModelId("glm-4.5")).toThrow(
      "Z.AI agents only support",
    );
    expect(() => normalizeZaiModelId("zai-coding-plan/glm-4.6")).toThrow(
      "Z.AI agents only support",
    );
  });
});
