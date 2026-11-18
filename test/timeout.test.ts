// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { describe, it, expect } from "bun:test";
import { withTimeout } from "../src/compaction/timeout.js";

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("withTimeout", () => {
  it("resolves when the promise settles before the timeout", async () => {
    const value = await withTimeout(
      (async () => {
        await tick(5);
        return 42;
      })(),
      200,
      "too slow",
    );
    expect(value).toBe(42);
  });

  it("rejects with the message when the promise is too slow", async () => {
    let error: unknown = null;
    try {
      await withTimeout(
        (async () => {
          await tick(200);
          return 1;
        })(),
        10,
        "timed out",
      );
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("timed out");
  });

  it("propagates the original rejection when it happens before the timeout", async () => {
    let error: unknown = null;
    try {
      await withTimeout(Promise.reject(new Error("boom")), 200, "too slow");
    } catch (e) {
      error = e;
    }
    expect((error as Error).message).toBe("boom");
  });

  it("returns the promise unchanged for non-positive ms", async () => {
    const p = Promise.resolve(7);
    expect(await withTimeout(p, 0, "n/a")).toBe(7);
    expect(await withTimeout(p, -5, "n/a")).toBe(7);
  });
});
