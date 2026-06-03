import { describe, it, expect } from "bun:test";
import { createHookContext, runLayerPipeline } from "../src/hook";
import type { Layer, LayerContent } from "../src/layers";
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

