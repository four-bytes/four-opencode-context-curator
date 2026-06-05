import { describe, it, expect, vi, beforeEach } from 'bun:test';

// Mock detectUserCompactionTrigger by importing from source
import { detectUserCompactionTrigger } from '../src/four-opencode-context-curator.js';

describe('detectUserCompactionTrigger', () => {
  it('detects "compact now"', () => {
    const r = detectUserCompactionTrigger('compact now');
    expect(r.shouldCompact).toBe(true);
    expect(r.mode).toBe('compact_now');
  });

  it('detects "force compact"', () => {
    const r = detectUserCompactionTrigger('force compact');
    expect(r.shouldCompact).toBe(true);
    expect(r.mode).toBe('compact_now');
  });

  it('detects "/compact"', () => {
    const r = detectUserCompactionTrigger('/compact');
    expect(r.shouldCompact).toBe(true);
    expect(r.mode).toBe('compact_now');
  });

  it('detects "compact soon"', () => {
    const r = detectUserCompactionTrigger('compact soon');
    expect(r.shouldCompact).toBe(true);
    expect(r.mode).toBe('compact_soon');
  });

  it('rejects unrelated text', () => {
    const r = detectUserCompactionTrigger('hello world');
    expect(r.shouldCompact).toBe(false);
    expect(r.mode).toBe('no_compact');
  });

  it('rejects "compact" alone (no modifier)', () => {
    const r = detectUserCompactionTrigger('compact');
    expect(r.shouldCompact).toBe(false);
  });

  it('detects "/compact" with surrounding whitespace', () => {
    const r = detectUserCompactionTrigger('  /compact  ');
    expect(r.shouldCompact).toBe(true);
    expect(r.mode).toBe('compact_now');
  });

  it('detects "compact now!" with punctuation', () => {
    const r = detectUserCompactionTrigger('compact now!');
    expect(r.shouldCompact).toBe(true);
    expect(r.mode).toBe('compact_now');
  });
});
