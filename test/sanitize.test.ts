import { describe, it, expect } from "bun:test";
import { sanitizeLayerContent } from "../src/sanitize";

describe("sanitizeLayerContent", () => {
  it("removes standalone closing XML artifacts", () => {
    const input = [
      "## Tech Stack",
      "- PHP 8.3",
      "</function_call>",
      "</function_calls>",
      "- Symfony 7",
      "</response>",
    ].join("\n");

    const result = sanitizeLayerContent(input);
    expect(result).toContain("PHP 8.3");
    expect(result).toContain("Symfony 7");
    expect(result).not.toContain("</function_call>");
    expect(result).not.toContain("</response>");
  });

  it("preserves real content that contains angle brackets", () => {
    const input = [
      "## Route Definition",
      '#[Route("/api/health")]',
      "class HealthController",
      "{",
      "    // ...",
      "}",
    ].join("\n");

    const result = sanitizeLayerContent(input);
    expect(result).toContain('#[Route("/api/health")]');
    expect(result).toContain("class HealthController");
  });

  it("handles empty content", () => {
    expect(sanitizeLayerContent("")).toBe("");
    expect(sanitizeLayerContent("  \n  \n")).toBe("  \n  \n");
  });

  it("only removes standalone artifacts, not inline ones", () => {
    const input = "text </function_call> more text";
    const result = sanitizeLayerContent(input);
    // Inline not removed — only standalone lines
    expect(result).toBe(input);
  });
});