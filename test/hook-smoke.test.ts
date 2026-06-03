import { describe, it, expect, afterEach } from "bun:test";
import { createHookContext, runLayerPipeline } from "../src/hook";
import type { Layer, LayerContent } from "../src/layers";
import { FourContextCuratorPlugin } from "../src/four-opencode-context-curator";
import { getLastUserModel, clearSignal } from "../src/compaction/state";

describe("Hook Pipeline", () => {
  it("runs with empty layers array", async () => {
    const ctx = createHookContext(
      [{ id: "core_prefix", order: 1, enabled: true }],
      [],
    );
    const results = await runLayerPipeline(ctx);
    expect(results).toEqual([]);
  });

  it("runs with single layer generating content", async () => {
    const testLayer: Layer = {
      config: { id: "test", order: 1, enabled: true },
      generate: async (): Promise<LayerContent> => ({
        content: "test content",
        updatedAt: Date.now(),
        source: "test",
      }),
    };
    const ctx = createHookContext(
      [{ id: "test", order: 1, enabled: true }],
      [testLayer],
    );
    const results = await runLayerPipeline(ctx);
    expect(results).toHaveLength(1);
    expect(results[0]).toBe("test content");
  });
});

describe("updateModel", () => {
  afterEach(() => {
    clearSignal("test");
  });

  it("detects info.model.providerID + info.model.modelID", async () => {
    const hooks = await FourContextCuratorPlugin({
      client: {} as any,
      project: {} as any,
      directory: "",
      worktree: "",
      experimental_workspace: { register: () => {} } as any,
      serverUrl: new URL("http://localhost:3000"),
      $: {} as any,
    });
    const transform = hooks["experimental.chat.messages.transform"];
    expect(transform).toBeDefined();

    await transform!({ sessionID: "test" }, {
      messages: [
        {
          info: { role: "user" },
          parts: [{ type: "text", text: "hello" }],
        },
        {
          info: {
            role: "user",
            model: { providerID: "openai", modelID: "gpt-4" },
          },
          parts: [{ type: "text", text: "use gpt-4" }],
        },
      ],
    });

    const model = getLastUserModel("test");
    expect(model.providerID).toBe("openai");
    expect(model.modelID).toBe("gpt-4");
  });
});
