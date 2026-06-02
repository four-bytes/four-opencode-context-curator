import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import * as fs from "node:fs";

describe("Debug Logger", () => {
  let fsAppendSpy: ReturnType<typeof spyOn>;
  let fsExistsSpy: ReturnType<typeof spyOn>;
  let fsMkdirSpy: ReturnType<typeof spyOn>;
  let logDebugEvent: (type: string, payload: Record<string, unknown>) => void;

  beforeEach(async () => {
    fsAppendSpy = spyOn(fs, "appendFileSync").mockImplementation(() => {});
    fsExistsSpy = spyOn(fs, "existsSync").mockReturnValue(true);
    fsMkdirSpy = spyOn(fs, "mkdirSync").mockImplementation(() => {});

    delete process.env.CC_DEBUG;
    const mod = await import("../src/debug-logger");
    logDebugEvent = mod.logDebugEvent;
  });

  afterEach(() => {
    fsAppendSpy?.mockRestore();
    fsExistsSpy?.mockRestore();
    fsMkdirSpy?.mockRestore();
    delete process.env.CC_DEBUG;
  });

  it("is no-op when CC_DEBUG is not set", () => {
    logDebugEvent("test.event", { foo: "bar" });

    expect(fsAppendSpy).not.toHaveBeenCalled();
    expect(fsMkdirSpy).not.toHaveBeenCalled();
  });

  it("writes JSONL line with correct fields when CC_DEBUG=true", () => {
    process.env.CC_DEBUG = "true";
    logDebugEvent("test.event", { foo: "bar", num: 42 });

    expect(fsAppendSpy).toHaveBeenCalledTimes(1);

    const [pathArg, contentArg] = fsAppendSpy.mock.calls[0];

    expect(pathArg).toMatch(
      /four-opencode-context-curator\/debug-\d{4}-\d{2}-\d{2}\.jsonl$/,
    );

    const parsed = JSON.parse((contentArg as string).trim());
    expect(parsed.type).toBe("test.event");
    expect(parsed.foo).toBe("bar");
    expect(parsed.num).toBe(42);
    expect(typeof parsed.ts).toBe("number");
    expect(parsed.ts).toBeGreaterThan(0);
  });

  it("never throws even with empty payload", () => {
    process.env.CC_DEBUG = "true";
    expect(() => {
      logDebugEvent("test", {});
    }).not.toThrow();
  });
});
