// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

/**
 * Reject when `promise` does not settle within `ms` milliseconds.
 *
 * The underlying promise is NOT aborted — the caller simply stops waiting and
 * the original promise is left to settle (or hang) on its own. This is the
 * desired behaviour for opencode's native `session.summarize()`, which hangs in
 * opencode 1.19.6: we must not freeze the caller, but we also cannot safely
 * abort an SDK call we do not control.
 *
 * Non-positive or non-finite `ms` returns the promise unchanged (no timeout).
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  if (!Number.isFinite(ms) || ms <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
