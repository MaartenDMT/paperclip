import { describe, expect, it } from "vitest";
import { printMiniMaxStreamEvent } from "./index.js";

describe("minimax_local CLI", () => {
  it("exports the shared simple CLI stream formatter", () => {
    expect(printMiniMaxStreamEvent).toBeTypeOf("function");
  });
});
