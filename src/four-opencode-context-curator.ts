import type { Plugin } from "@opencode-ai/plugin";
import { DEFAULT_LAYERS, type Layer } from "./layers.js";
import { createHookContext, runLayerPipeline } from "./hook.js";
import { sanitizeLayerContent } from "./sanitize.js";
import { CorePrefixLayer } from "./layers/core-prefix.js";
import { RepoProfileLayer } from "./layers/repo-profile.js";
import { TaskSliceLayer } from "./layers/task-slice.js";
import { IssueSliceLayer } from "./layers/issue-slice.js";

/**
 * Curates system prompt context via layered cacheable prefixes.
 * Wave P4a (BIG WIN): 4 Cache-Layer (core_prefix, repo_profile, task_slice, issue_slice).
 */
export const FourContextCuratorPlugin: Plugin = async (_ctx) => {
  const layers: Layer[] = [
    new CorePrefixLayer(),
    new RepoProfileLayer(),
    new TaskSliceLayer(),
    new IssueSliceLayer(),
  ];

  const ctx = createHookContext(DEFAULT_LAYERS, layers);

  return {
    "experimental.chat.system.transform": async (_input, output) => {
      const layerContents = await runLayerPipeline(ctx);

      if (layerContents.length > 0) {
        const prefix = [
          "── CONTEXT CURATOR (Layered Cacheable Prefixes) ──",
          ...layerContents.map(sanitizeLayerContent),
        ].join("\n\n");
        output.system.push(prefix);
      }
    },
  };
};

export default FourContextCuratorPlugin;
