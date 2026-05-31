import type { Plugin } from "@opencode-ai/plugin";

/**
 * Curates context for opencode requests — sends only changed blocks + N context lines.
 * Sprint 2: skeleton only, hooks come in #2.
 */
export const FourContextCuratorPlugin: Plugin = async (_ctx) => {
  return {};
};

export default FourContextCuratorPlugin;
