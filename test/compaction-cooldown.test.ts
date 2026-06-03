import { describe, it, expect, beforeEach } from "bun:test";
import {
  startCompactionCooldown,
  decrementCompactionCooldown,
  isInCompactionCooldown,
  getCompactionCooldownRemaining,
} from "../src/compaction/state.js";

describe("compaction cooldown", () => {
  beforeEach(() => {
    // Decrement until 0 to reset state between tests
    while (isInCompactionCooldown("test")) {
      decrementCompactionCooldown("test");
    }
  });

  it("startCompactionCooldown(3) sets remaining to 3", () => {
    startCompactionCooldown("test", 3);
    expect(isInCompactionCooldown("test")).toBe(true);
    expect(getCompactionCooldownRemaining("test")).toBe(3);
  });

  it("3x decrement clears cooldown", () => {
    startCompactionCooldown("test", 3);
    decrementCompactionCooldown("test");
    expect(getCompactionCooldownRemaining("test")).toBe(2);
    decrementCompactionCooldown("test");
    expect(getCompactionCooldownRemaining("test")).toBe(1);
    decrementCompactionCooldown("test");
    expect(isInCompactionCooldown("test")).toBe(false);
    expect(getCompactionCooldownRemaining("test")).toBe(0);
  });

  it("4th decrement does not underflow (stays 0)", () => {
    startCompactionCooldown("test", 1);
    decrementCompactionCooldown("test");
    expect(getCompactionCooldownRemaining("test")).toBe(0);
    decrementCompactionCooldown("test");
    expect(getCompactionCooldownRemaining("test")).toBe(0);
  });

  it("Max-semantik: startCompactionCooldown(1) after start(3) bleibt 3", () => {
    startCompactionCooldown("test", 3);
    startCompactionCooldown("test", 1);
    expect(getCompactionCooldownRemaining("test")).toBe(3);
  });
});
