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
    while (isInCompactionCooldown()) {
      decrementCompactionCooldown();
    }
  });

  it("startCompactionCooldown(3) sets remaining to 3", () => {
    startCompactionCooldown(3);
    expect(isInCompactionCooldown()).toBe(true);
    expect(getCompactionCooldownRemaining()).toBe(3);
  });

  it("3× decrement clears cooldown", () => {
    startCompactionCooldown(3);
    decrementCompactionCooldown();
    expect(getCompactionCooldownRemaining()).toBe(2);
    decrementCompactionCooldown();
    expect(getCompactionCooldownRemaining()).toBe(1);
    decrementCompactionCooldown();
    expect(isInCompactionCooldown()).toBe(false);
    expect(getCompactionCooldownRemaining()).toBe(0);
  });

  it("4th decrement does not underflow (stays 0)", () => {
    startCompactionCooldown(1);
    decrementCompactionCooldown();
    expect(getCompactionCooldownRemaining()).toBe(0);
    decrementCompactionCooldown();
    expect(getCompactionCooldownRemaining()).toBe(0);
  });

  it("Max-semantik: startCompactionCooldown(1) after start(3) bleibt 3", () => {
    startCompactionCooldown(3);
    startCompactionCooldown(1);
    expect(getCompactionCooldownRemaining()).toBe(3);
  });
});
