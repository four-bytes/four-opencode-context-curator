import { describe, it, expect } from "bun:test";
import { extractMessageModel } from "../src/compaction/state.js";

describe("extractMessageModel", () => {
  it("extracts the model from a UserMessage shape (nested model object)", () => {
    const info = {
      role: "user",
      agent: "build",
      model: { providerID: "anthropic", modelID: "claude-sonnet-4" },
    };

    expect(extractMessageModel(info)).toEqual({
      providerID: "anthropic",
      modelID: "claude-sonnet-4",
    });
  });

  it("extracts the model from an AssistantMessage shape (top-level IDs)", () => {
    const info = {
      role: "assistant",
      providerID: "openai",
      modelID: "gpt-5",
    };

    expect(extractMessageModel(info)).toEqual({
      providerID: "openai",
      modelID: "gpt-5",
    });
  });

  it("returns null for an unknown/missing shape", () => {
    expect(extractMessageModel({ role: "user", agent: "build" })).toBeNull();
    expect(extractMessageModel({ role: "user", model: { providerID: "x" } })).toBeNull();
    expect(extractMessageModel({ role: "user", model: "not-an-object" })).toBeNull();
    expect(extractMessageModel({ providerID: "openai" })).toBeNull();
    expect(extractMessageModel(null)).toBeNull();
    expect(extractMessageModel(undefined)).toBeNull();
    expect(extractMessageModel("assistant")).toBeNull();
  });
});
