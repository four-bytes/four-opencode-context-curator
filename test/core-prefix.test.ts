import { describe, it, expect } from "bun:test";
import { CorePrefixLayer } from "../src/layers/core-prefix";

describe("CorePrefixLayer", () => {
  it("generates static content with no dynamic values", async () => {
    const layer = new CorePrefixLayer();
    const result = await layer.generate();

    expect(result.content).toContain("GLOBAL RULES");
    expect(result.content).toContain("Stop-Mode");
    expect(result.content).toContain("Search Discipline");
    expect(result.content).toContain("Quality Gates");

    // No dynamic content (e.g. dates, random IDs)
    expect(result.content).not.toMatch(/\d{4}-\d{2}-\d{2}/); // no dates
  });

  it("returns source reference", async () => {
    const layer = new CorePrefixLayer();
    const result = await layer.generate();
    expect(result.source).toContain(".personal-config");
  });
});
