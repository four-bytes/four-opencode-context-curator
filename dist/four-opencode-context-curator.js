// @bun
var __require = import.meta.require;

// src/layers.ts
var DEFAULT_LAYERS = [
  { id: "repo_profile", order: 2, enabled: true },
  { id: "task_slice", order: 3, enabled: true, ttlMs: 30 * 60 * 1000 },
  { id: "issue_slice", order: 4, enabled: true }
];

// src/hook.ts
function createHookContext(configs, layers) {
  return {
    layers,
    configs,
    cache: new Map
  };
}
async function runLayerPipeline(ctx) {
  const results = [];
  const enabled = ctx.configs.filter((c) => c.enabled).sort((a, b) => a.order - b.order);
  for (const config of enabled) {
    const layer = ctx.layers.find((l) => l.config.id === config.id);
    if (!layer)
      continue;
    if (config.ttlMs) {
      const cached = ctx.cache.get(config.id);
      if (cached && Date.now() - cached.updatedAt < config.ttlMs) {
        results.push(cached.content);
        continue;
      }
    }
    try {
      const content = await layer.generate();
      ctx.cache.set(config.id, content);
      if (content.content.trim()) {
        results.push(content.content);
      }
    } catch (err) {
      console.warn(`[four-cc] layer '${config.id}' failed:`, err);
    }
  }
  return results;
}

// src/sanitize.ts
function sanitizeLayerContent(content) {
  const artifactPatterns = [
    /^\s*<\/function_call>\s*$/,
    /^\s*<\/function_calls>\s*$/,
    /^\s*<\/function_call_stack>\s*$/,
    /^\s*<\/response>\s*$/,
    /^\s*<\/content>\s*$/
  ];
  const lines = content.split(`
`);
  const cleaned = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (artifactPatterns.some((p) => p.test(trimmed))) {
      continue;
    }
    if (trimmed === "}" && cleaned.length > 0) {
      const prev = cleaned[cleaned.length - 1].trim();
      if (prev === "" || prev.startsWith("//") || prev === "{") {
        continue;
      }
    }
    cleaned.push(line);
  }
  return cleaned.join(`
`);
}

// src/layers/repo-profile.ts
import { readFile, stat } from "fs/promises";
import { resolve } from "path";

class RepoProfileLayer {
  config;
  constructor() {
    this.config = {
      id: "repo_profile",
      order: 2,
      enabled: true
    };
  }
  async generate() {
    const now = Date.now();
    const cwd = process.cwd();
    const files = await this.findProjectFiles(cwd);
    const sections = [];
    for (const filePath of files) {
      try {
        const content2 = await readFile(filePath, "utf-8");
        const extracted = this.extractSections(content2);
        if (extracted) {
          sections.push(`## ${this.label(filePath)} (${filePath})`, extracted);
        }
      } catch {}
    }
    if (sections.length === 0) {
      return { content: "", updatedAt: now, source: "repo_profile (no project files found)" };
    }
    let content = sections.join(`

`);
    if (content.length > 3000) {
      content = content.slice(0, 3000) + `

(truncated \u2014 repo_profile >3000 chars)`;
    }
    return { content, updatedAt: now, source: "workspace AGENTS.md/CLAUDE.md" };
  }
  async findProjectFiles(cwd) {
    const candidates = ["AGENTS.md", "CLAUDE.md"];
    const found = [];
    for (let depth = 0;depth <= 3; depth++) {
      for (const name of candidates) {
        const p = resolve(cwd, ...Array(depth).fill(".."), name);
        try {
          await stat(p);
          found.push(p);
        } catch {}
      }
      if (found.length > 0)
        break;
    }
    return found;
  }
  label(path) {
    const basename = path.split("/").pop() || path;
    return basename === "AGENTS.md" ? "AGENTS" : "CLAUDE";
  }
  extractSections(content) {
    const lines = content.split(`
`);
    const relevant = [];
    let capture = false;
    const triggers = [
      "Tech Stack",
      "Tech-Stack",
      "Runtime",
      "Language",
      "Framework",
      "Conventions",
      "Convention",
      "Standards",
      "Naming",
      "Forbidden",
      "Verboten",
      "Anti-Pattern",
      "Deny",
      "Build & Development",
      "Development Commands"
    ];
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("## ") && triggers.some((t) => trimmed.toLowerCase().includes(t.toLowerCase()))) {
        capture = true;
        relevant.push(trimmed);
      } else if (trimmed.startsWith("## ")) {
        capture = false;
      } else if (capture && trimmed.length > 0) {
        if (relevant.filter((l) => l.startsWith("-") || l.startsWith("*")).length < 30) {
          relevant.push(trimmed);
        }
      }
    }
    return relevant.length > 1 ? relevant.join(`
`) : "";
  }
}

// src/layers/task-slice.ts
class TaskSliceLayer {
  config;
  lastContent;
  lastFetchTime = 0;
  constructor() {
    this.config = {
      id: "task_slice",
      order: 3,
      enabled: true,
      ttlMs: 30 * 60 * 1000
    };
  }
  async generate() {
    const now = Date.now();
    if (this.lastContent && now - this.lastFetchTime < (this.config.ttlMs || 0)) {
      return this.lastContent;
    }
    const task = process.env.OPENDOC_TASK || process.env.TASK || "";
    if (!task.trim()) {
      const empty = { content: "", updatedAt: now, source: "task_slice (no task)" };
      this.lastContent = empty;
      this.lastFetchTime = now;
      return empty;
    }
    const content = [
      "CURRENT TASK",
      task
    ].join(`
`);
    const result = { content, updatedAt: now, source: "OPENDOC_TASK env" };
    this.lastContent = result;
    this.lastFetchTime = now;
    return result;
  }
}

// src/layers/issue-slice.ts
import { execSync } from "child_process";

class IssueSliceLayer {
  config;
  constructor() {
    this.config = {
      id: "issue_slice",
      order: 4,
      enabled: true
    };
  }
  async generate() {
    const now = Date.now();
    const issueRef = await this.detectIssue();
    if (!issueRef) {
      return { content: "", updatedAt: now, source: "issue_slice (no issue)" };
    }
    try {
      const issueBody = execSync(`gh issue view ${issueRef} --json title,number,labels,state -q '.' 2>/dev/null || echo ""`, {
        encoding: "utf-8",
        timeout: 5000,
        cwd: process.cwd()
      }).trim();
      if (!issueBody || issueBody === "null") {
        return { content: "", updatedAt: now, source: `issue_slice (gh returned null for #${issueRef})` };
      }
      const content = [
        `ACTIVE ISSUE: #${issueRef}`,
        issueBody
      ].join(`
`);
      return { content, updatedAt: now, source: `gh issue view #${issueRef}` };
    } catch (err) {
      return {
        content: "",
        updatedAt: now,
        source: `issue_slice (gh failed: ${err})`
      };
    }
  }
  async detectIssue() {
    const envIssue = process.env.GH_ISSUE || process.env.ISSUE;
    if (envIssue)
      return envIssue.replace("#", "");
    try {
      const branch = execSync("git rev-parse --abbrev-ref HEAD 2>/dev/null || echo ''", {
        encoding: "utf-8",
        timeout: 3000,
        cwd: process.cwd()
      }).trim();
      const ghMatch = branch.match(/GH-(\d+)/);
      if (ghMatch)
        return ghMatch[1];
      const numMatch = branch.match(/(\d+)/);
      if (numMatch)
        return numMatch[1];
    } catch {}
    return null;
  }
}

// src/compaction/signal-injector.ts
function createCompactionInstruction(_sessionID = "default") {
  return `\u2500\u2500 COMPACTION: Active. Summarize completed work. \u2500\u2500`;
}

// src/compaction/signal-parser.ts
function parseCompactionSignal(text) {
  const adviceMatch = text.match(/compaction_advice:\s*(no_compact|compact_soon|compact_now)/i);
  if (!adviceMatch)
    return null;
  if (adviceMatch.index !== undefined && adviceMatch.index < text.length - Math.max(300, Math.ceil(text.length * 0.2)))
    return null;
  const adviceRaw = adviceMatch[1].toLowerCase();
  if (adviceRaw !== "no_compact" && adviceRaw !== "compact_soon" && adviceRaw !== "compact_now") {
    return null;
  }
  const advice = adviceRaw;
  const reasonMatch = text.match(/reason:\s*(.+)/i);
  const reason = reasonMatch ? reasonMatch[1].trim() : "";
  const safeMatch = text.match(/safe_to_compact:\s*(.+)/i);
  const safeToCompact = safeMatch ? safeMatch[1].split(",").map((s) => s.trim()).filter(Boolean) : [];
  return { advice, reason, safeToCompact };
}
function stripCompactionSignal(text) {
  return text.replace(/\n*compaction_advice:.*[\s\S]*$/i, "").trimEnd();
}

// src/compaction/state.ts
var sessionStates = new Map;
function getSessionState(sessionID = "default") {
  let s = sessionStates.get(sessionID);
  if (!s) {
    s = {
      lastSignal: null,
      appliedForPruning: new Set,
      appliedForMessages: new Set,
      history: [],
      lastUserModel: { providerID: undefined, modelID: undefined },
      lastTokenEstimate: 0,
      compactingActive: false,
      turnsSinceCompaction: 0,
      instructionSent: false
    };
    sessionStates.set(sessionID, s);
  }
  return s;
}
function getCompactionState(sessionID = "default") {
  return getSessionState(sessionID);
}
function setLastSignal(sessionID, signal) {
  getSessionState(sessionID).lastSignal = signal;
}
function clearSignal(sessionID = "default") {
  const s = getSessionState(sessionID);
  s.lastSignal = null;
  s.appliedForPruning.clear();
  s.appliedForMessages.clear();
}
function markAppliedPruning(sessionID, block) {
  getSessionState(sessionID).appliedForPruning.add(block);
}
function wasAppliedPruning(sessionID, block) {
  return getSessionState(sessionID).appliedForPruning.has(block);
}
function markAppliedMessages(sessionID, block) {
  getSessionState(sessionID).appliedForMessages.add(block);
}
function clearTransformState(sessionID = "default") {
  const s = getSessionState(sessionID);
  s.appliedForPruning.clear();
  s.appliedForMessages.clear();
}
function addEvent(sessionID, event) {
  getSessionState(sessionID).history.push(event);
}
function setLastUserModel(sessionID, providerID, modelID) {
  getSessionState(sessionID).lastUserModel = { providerID, modelID };
}
function setLastTokenEstimate(sessionID, n) {
  getSessionState(sessionID).lastTokenEstimate = n;
}
var compactionCooldowns = new Map;
function decrementCompactionCooldown(sessionID) {
  const current = compactionCooldowns.get(sessionID) ?? 0;
  if (current > 0)
    compactionCooldowns.set(sessionID, current - 1);
}
function getCompactionCooldownRemaining(sessionID) {
  return compactionCooldowns.get(sessionID) ?? 0;
}
function setCompactionCooldown(sessionID, turns = 3) {
  compactionCooldowns.set(sessionID, turns);
}
function incrementTurnsSinceCompaction(sessionID = "default") {
  getSessionState(sessionID).turnsSinceCompaction++;
}
function resetTurnsSinceCompaction(sessionID = "default") {
  getSessionState(sessionID).turnsSinceCompaction = 0;
}
function getTurnsSinceCompaction(sessionID = "default") {
  return getSessionState(sessionID).turnsSinceCompaction;
}
function isInstructionSent(sessionID = "default") {
  return getSessionState(sessionID).instructionSent;
}
function markInstructionSent(sessionID = "default") {
  getSessionState(sessionID).instructionSent = true;
}

// src/compaction/diary.ts
import { appendFileSync, existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
var CACHE_DIR = join(homedir(), ".cache", "opencode", "four-opencode-context-curator");
function getDiaryPath() {
  const sessionId = process.env.OPENDOC_SESSION_ID || process.env.SESSION_ID || "unknown";
  const date = new Date().toISOString().split("T")[0];
  return join(CACHE_DIR, `compaction-events-${sessionId}-${date}.jsonl`);
}
function ensureDir() {
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true });
  }
}
function writeDiaryEntry(entry) {
  try {
    ensureDir();
    const line = JSON.stringify(entry) + `
`;
    appendFileSync(getDiaryPath(), line, "utf-8");
  } catch {}
}

// src/compaction/hash.ts
function simpleHash(str) {
  let hash = 0;
  for (let i = 0;i < str.length; i++) {
    const chr = str.charCodeAt(i);
    hash = (hash << 5) - hash + chr;
    hash |= 0;
  }
  return String(hash);
}

// src/compaction/pruning-engine.ts
var DEFAULT_CONFIG = {
  maxToolLogLines: 50,
  headerLines: 10,
  footerLines: 10,
  minCompletedBlocks: 1
};
function truncateToolLogs(text, maxLines = DEFAULT_CONFIG.maxToolLogLines) {
  const lines = text.split(`
`);
  if (lines.length <= maxLines)
    return text;
  const header = lines.slice(0, DEFAULT_CONFIG.headerLines).join(`
`);
  const footer = lines.slice(-DEFAULT_CONFIG.footerLines).join(`
`);
  const truncated = lines.length - DEFAULT_CONFIG.headerLines - DEFAULT_CONFIG.footerLines;
  return `${header}
\u2026 [${truncated} lines truncated] \u2026
${footer}`;
}
function deduplicateToolOutputs(contents) {
  const seen = new Map;
  const result = [];
  let duplicatesRemoved = 0;
  for (const content of contents) {
    const hash = simpleHash(content);
    if (seen.has(hash)) {
      const blockIndex = seen.get(hash);
      result.push(`\u2191 see above (block ${blockIndex + 1})`);
      duplicatesRemoved++;
    } else {
      seen.set(hash, result.length);
      result.push(content);
    }
  }
  return { contents: result, duplicatesRemoved };
}
function condenseIssueSlice(content, safeToCompact) {
  if (safeToCompact.length === 0)
    return content;
  if (!content.includes("ACTIVE ISSUE:"))
    return content;
  const issueMatch = content.match(/ACTIVE ISSUE:\s*#(\d+)/);
  if (!issueMatch)
    return content;
  const issueNr = issueMatch[1];
  const isCompleted = safeToCompact.some((b) => b.toLowerCase().includes(`issue_${issueNr}`));
  if (!isCompleted)
    return content;
  const titleMatch = content.match(/"title"\s*:\s*"([^"]+)"/);
  const title = titleMatch ? titleMatch[1] : "";
  const now = new Date().toISOString().split("T")[0];
  return `Issue #${issueNr}: ${title} \u2014 COMPLETED (${now})`;
}
function applyPruning(layerContents, config = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const sessionID = cfg.sessionID ?? process.env.OPENDOC_SESSION_ID ?? "default";
  const state = getCompactionState(sessionID);
  const signal = state.lastSignal;
  const stats = {
    originalLines: layerContents.reduce((sum, c) => sum + c.split(`
`).length, 0),
    prunedLines: 0,
    blocksCondensed: 0,
    duplicatesRemoved: 0
  };
  if (signal?.advice === "no_compact") {
    stats.prunedLines = stats.originalLines;
    return { contents: layerContents, stats };
  }
  if (signal && signal.safeToCompact.length > 0) {
    const newBlocks = signal.safeToCompact.filter((b) => !wasAppliedPruning(sessionID, b));
    if (newBlocks.length === 0) {
      const { contents: dedupedOnly, duplicatesRemoved: duplicatesRemoved2 } = deduplicateToolOutputs(layerContents.map((c) => truncateToolLogs(c, cfg.maxToolLogLines)));
      stats.prunedLines = dedupedOnly.reduce((sum, c) => sum + c.split(`
`).length, 0);
      stats.duplicatesRemoved = duplicatesRemoved2;
      return { contents: dedupedOnly, stats };
    }
  }
  const truncated = layerContents.map((c) => truncateToolLogs(c, cfg.maxToolLogLines));
  const { contents: deduped, duplicatesRemoved } = deduplicateToolOutputs(truncated);
  stats.duplicatesRemoved = duplicatesRemoved;
  const safeToCompact = signal?.safeToCompact ?? [];
  const condensed = deduped.map((c) => {
    const condensedContent = condenseIssueSlice(c, safeToCompact);
    if (condensedContent !== c)
      stats.blocksCondensed++;
    return condensedContent;
  });
  stats.prunedLines = condensed.reduce((sum, c) => sum + c.split(`
`).length, 0);
  if (signal) {
    for (const block of safeToCompact) {
      markAppliedPruning(sessionID, block);
    }
  }
  addEvent(sessionID, {
    ts: Date.now(),
    advice: signal?.advice ?? "triggered",
    reason: signal?.reason ?? "CC_COMPACTION_TRIGGER",
    blocksCondensed: stats.blocksCondensed
  });
  const reductionPct = stats.originalLines > 0 ? Math.round((stats.originalLines - stats.prunedLines) / stats.originalLines * 100) : 0;
  writeDiaryEntry({
    ts: Date.now(),
    advice: signal?.advice ?? "triggered",
    reason: signal?.reason ?? "CC_COMPACTION_TRIGGER",
    blocksCondensed: stats.blocksCondensed,
    duplicatesRemoved: stats.duplicatesRemoved,
    linesBefore: stats.originalLines,
    linesAfter: stats.prunedLines,
    reductionPct,
    sessionId: process.env.OPENDOC_SESSION_ID || "unknown",
    triggered: false
  });
  return { contents: condensed, stats };
}

// src/debug-logger.ts
import * as fs from "fs";
import * as os from "os";
import { join as join2 } from "path";
function getCacheDir() {
  return join2(os.homedir(), ".cache", "opencode", "four-opencode-context-curator");
}
function getLogPath() {
  const sessionId = process.env.OPENDOC_SESSION_ID || process.env.SESSION_ID || "unknown";
  const date = new Date().toISOString().split("T")[0];
  return join2(getCacheDir(), `debug-${sessionId}-${date}.jsonl`);
}
function ensureDir2() {
  const dir = getCacheDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
function logDebugEvent(type, payload) {
  if (process.env.CC_DEBUG !== "true")
    return;
  try {
    ensureDir2();
    const event = { ts: Date.now(), type, ...payload };
    const line = JSON.stringify(event) + `
`;
    fs.appendFileSync(getLogPath(), line, "utf-8");
  } catch {}
}

// src/compaction/message-compactor.ts
var MAX_TOOL_LINES = 50;
var HEADER_LINES = 10;
var FOOTER_LINES = 10;
function countChars(messages) {
  let total = 0;
  for (const msg of messages) {
    for (const part of msg.parts) {
      if (part.type === "text" && part.text) {
        total += part.text.length;
      }
    }
  }
  return total;
}
function truncateMessageParts(messages) {
  let truncations = 0;
  for (const msg of messages) {
    if (msg.info.role === "user")
      continue;
    for (const part of msg.parts) {
      if (part.type === "text" && part.text) {
        const lines = part.text.split(`
`);
        if (lines.length > MAX_TOOL_LINES) {
          part.text = [
            ...lines.slice(0, HEADER_LINES),
            `\u2026 [${lines.length - HEADER_LINES - FOOTER_LINES} lines truncated] \u2026`,
            ...lines.slice(-FOOTER_LINES)
          ].join(`
`);
          truncations++;
        }
      }
    }
  }
  return truncations;
}
function deduplicateMessageParts(messages) {
  const seen = new Map;
  let duplicates = 0;
  for (let msgIdx = 0;msgIdx < messages.length; msgIdx++) {
    const msg = messages[msgIdx];
    if (msg.info.role === "user")
      continue;
    for (const part of msg.parts) {
      if (part.type === "text" && part.text && part.text.length > 20) {
        const hash = simpleHash(part.text);
        if (seen.has(hash)) {
          const firstMsgIdx = seen.get(hash);
          part.text = `\u2191 see above (message ${firstMsgIdx + 1})`;
          duplicates++;
        } else {
          seen.set(hash, msgIdx);
        }
      }
    }
  }
  return duplicates;
}
function extractSessionId(messages) {
  for (const msg of messages) {
    if (msg.info.sessionID)
      return msg.info.sessionID;
  }
  return process.env.OPENDOC_SESSION_ID || process.env.SESSION_ID || "unknown";
}
function compactMessageHistory(messages, sessionID) {
  const sid = sessionID ?? process.env.OPENDOC_SESSION_ID ?? "default";
  const state = getCompactionState(sid);
  const signal = state.lastSignal;
  if (signal?.advice === "no_compact") {
    return {
      messagesBefore: messages.length,
      messagesAfter: messages.length,
      charsBefore: countChars(messages),
      charsAfter: countChars(messages),
      reductionPct: 0,
      applied: false,
      sessionId: extractSessionId(messages)
    };
  }
  const charsBefore = countChars(messages);
  const messagesBefore = messages.length;
  const sessionId = extractSessionId(messages);
  const truncations = truncateMessageParts(messages);
  const duplicates = deduplicateMessageParts(messages);
  const charsAfter = countChars(messages);
  const messagesAfter = messages.length;
  const reductionPct = charsBefore > 0 ? Math.round((charsBefore - charsAfter) / charsBefore * 100) : 0;
  if (signal) {
    for (const block of signal.safeToCompact) {
      markAppliedMessages(sid, block);
    }
  }
  addEvent(sid, {
    ts: Date.now(),
    advice: signal?.advice ?? "triggered",
    reason: signal?.reason ?? "CC_COMPACTION_TRIGGER",
    blocksCondensed: truncations + duplicates
  });
  writeDiaryEntry({
    ts: Date.now(),
    advice: signal?.advice ?? "triggered",
    reason: signal?.reason ?? "CC_COMPACTION_TRIGGER",
    blocksCondensed: truncations + duplicates,
    duplicatesRemoved: duplicates,
    linesBefore: charsBefore,
    linesAfter: charsAfter,
    reductionPct,
    sessionId,
    triggered: false
  });
  logDebugEvent("compaction.applied", {
    messagesBefore,
    messagesAfter,
    removed: 0,
    charsBefore,
    charsAfter,
    reductionPct,
    truncations,
    duplicates,
    advice: signal?.advice ?? "triggered",
    reason: signal?.reason ?? "CC_COMPACTION_TRIGGER",
    sessionId
  });
  const didWork = truncations > 0 || duplicates > 0;
  return {
    messagesBefore,
    messagesAfter,
    charsBefore,
    charsAfter,
    reductionPct,
    applied: didWork,
    sessionId
  };
}

// src/compaction/tokens.ts
function estimateTokens(text) {
  if (!text)
    return 0;
  return Math.ceil(text.length / 4);
}
function estimateMessageTokens(message) {
  if (!message || typeof message !== "object")
    return 0;
  const parts = message.parts;
  if (!Array.isArray(parts))
    return 0;
  let total = 0;
  for (const part of parts) {
    if (part && typeof part === "object") {
      const text = part.text;
      if (typeof text === "string")
        total += estimateTokens(text);
    }
  }
  return total;
}

// src/four-opencode-context-curator.ts
var FourContextCuratorPlugin = async (ctx) => {
  try {
    const fs2 = await import("fs");
    const path = await import("path");
    const pkgPath = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "package.json");
    let version = "unknown";
    try {
      const pkg = JSON.parse(fs2.readFileSync(pkgPath, "utf-8"));
      version = pkg.version ?? "unknown";
    } catch {}
    const ccDebug = process.env.CC_DEBUG ?? "unset";
    const pid = process.pid;
    process.stderr.write(`[four-opencode-context-curator] v${version} loaded (pid=${pid}, CC_DEBUG=${ccDebug})
`);
    logDebugEvent("compaction.plugin.loaded", { version, pid, ccDebug });
  } catch {}
  const layers = [
    new RepoProfileLayer,
    new TaskSliceLayer,
    new IssueSliceLayer
  ];
  const hookCtx = createHookContext(DEFAULT_LAYERS, layers);
  const client = ctx.client;
  async function triggerNativeCompaction(realSessionID) {
    const userModel = getCompactionState(realSessionID).lastUserModel;
    logDebugEvent("compaction.summarize.triggered", {
      sessionID: realSessionID,
      providerID: userModel.providerID,
      modelID: userModel.modelID
    });
    try {
      await client.session.summarize({
        path: { id: realSessionID },
        query: { directory: process.cwd() },
        body: {
          ...userModel.providerID ? { providerID: userModel.providerID } : {},
          ...userModel.modelID ? { modelID: userModel.modelID } : {}
        }
      }, { throwOnError: true });
      setCompactionCooldown(realSessionID, 3);
      logDebugEvent("compaction.summarize.completed", {
        sessionID: realSessionID,
        cooldown: 3
      });
    } catch (err) {
      const msg = `\x1B[31m[four-opencode-context-curator] \u274C compaction request failed (session=${realSessionID}): ${String(err)}\x1B[0m`;
      process.stderr.write(msg + `
`);
      logDebugEvent("compaction.summarize.error", {
        error: String(err),
        sessionID: realSessionID
      });
    }
  }
  return {
    "experimental.chat.system.transform": async (_input, output) => {
      const sessionID = _input?.sessionID ?? "default";
      const layerContents = await runLayerPipeline(hookCtx);
      logDebugEvent("compaction.system.transform", { layerCount: layerContents.length });
      if (layerContents.length > 0) {
        const sanitized = layerContents.map(sanitizeLayerContent);
        const pruned = applyPruning(sanitized, { sessionID });
        const prefix = pruned.contents.join(`

`);
        output.system.push(prefix);
      }
      if (!isInstructionSent(sessionID)) {
        output.system.push(createCompactionInstruction(sessionID));
        markInstructionSent(sessionID);
      }
    },
    "experimental.session.compacting": async (input, output) => {
      const sessionID = input?.sessionID ?? "default";
      try {
        const state = getCompactionState(sessionID);
        const signal = state.lastSignal;
        logDebugEvent("compaction.compacting", {
          advice: signal?.advice ?? "none"
        });
        if (signal?.advice === "no_compact")
          return;
        const lines = [
          "Compacting session. Preserve: active task, user instructions, recent 5 turns.",
          "Condense: completed issues. Truncate: >50-line tool logs."
        ];
        if (signal) {
          lines.push(`Signal: ${signal.advice}`);
        }
        output.prompt = lines.join(`
`);
      } catch {}
    },
    "experimental.chat.messages.transform": async (_input, output) => {
      const sessionID = _input?.sessionID ?? "default";
      try {
        logDebugEvent("compaction.messages.transform", { messageCount: output.messages.length });
        let lastUserMsg;
        for (let i = output.messages.length - 1;i >= 0; i--) {
          const m = output.messages[i];
          if (m.info?.role === "user") {
            lastUserMsg = output.messages[i];
            break;
          }
        }
        if (lastUserMsg) {
          const info = lastUserMsg.info;
          if (info) {
            let providerID;
            let modelID;
            let path;
            if (typeof info.providerID === "string" && typeof info.modelID === "string") {
              providerID = info.providerID;
              modelID = info.modelID;
              path = "info";
            } else if (typeof info.agent === "object" && info.agent !== null && typeof info.agent.providerID === "string" && typeof info.agent.modelID === "string") {
              providerID = info.agent.providerID;
              modelID = info.agent.modelID;
              path = "info.agent";
            } else if (typeof info.model === "object" && info.model !== null && typeof info.model.providerID === "string" && typeof info.model.modelID === "string") {
              providerID = info.model.providerID;
              modelID = info.model.modelID;
              path = "info.model";
            }
            if (path) {
              setLastUserModel(sessionID, providerID, modelID);
              logDebugEvent("compaction.user_model.updated", { providerID, modelID, path });
            } else {
              logDebugEvent("compaction.user_model.shape_unknown", { keys: Object.keys(info) });
            }
          }
        }
        const msgs = output.messages;
        for (let i = msgs.length - 1;i >= 0; i--) {
          const m = msgs[i];
          if (m.info?.role !== "assistant")
            continue;
          if (!Array.isArray(m.parts))
            continue;
          for (const part of m.parts) {
            if (part.type !== "text" || !part.text)
              continue;
            const signal = parseCompactionSignal(part.text);
            if (signal) {
              setLastSignal(sessionID, signal);
              logDebugEvent("compaction.signal.parsed", { advice: signal.advice, reason: signal.reason, sessionID });
              const signalMsg = msgs.find((m2) => m2.info?.sessionID);
              const realSessionID = signalMsg?.info?.sessionID ?? process.env.OPENDOC_SESSION_ID ?? "unknown";
              const inCooldown2 = getCompactionState(sessionID).compactingActive || getCompactionCooldownRemaining(sessionID) > 0;
              if (signal.advice === "compact_now" && !inCooldown2) {
                await triggerNativeCompaction(realSessionID);
                clearSignal(sessionID);
              } else if (signal.advice === "compact_now" && inCooldown2) {
                logDebugEvent("compaction.summarize.cooldown_skipped", {
                  sessionID: realSessionID,
                  cooldownRemaining: getCompactionCooldownRemaining(sessionID),
                  compactingActive: getCompactionState(sessionID).compactingActive
                });
                clearSignal(sessionID);
              }
              break;
            }
          }
          break;
        }
        decrementCompactionCooldown(sessionID);
        incrementTurnsSinceCompaction(sessionID);
        compactMessageHistory(output.messages, sessionID);
        let totalTokens = 0;
        for (const m of output.messages) {
          totalTokens += estimateMessageTokens(m);
        }
        setLastTokenEstimate(sessionID, totalTokens);
        logDebugEvent("compaction.tokens.estimated", { totalTokens, messageCount: output.messages.length });
        const AUTO_TOKEN_THRESHOLD = 50000;
        const AUTO_TURN_THRESHOLD = 3;
        const turnsSince = getTurnsSinceCompaction(sessionID);
        const inCooldown = getCompactionState(sessionID).compactingActive || getCompactionCooldownRemaining(sessionID) > 0;
        if (totalTokens > AUTO_TOKEN_THRESHOLD && turnsSince >= AUTO_TURN_THRESHOLD && !inCooldown) {
          const signalMsg2 = msgs.find((m) => m.info?.sessionID);
          const realSid2 = signalMsg2?.info?.sessionID ?? process.env.OPENDOC_SESSION_ID ?? "unknown";
          logDebugEvent("compaction.auto_trigger", { totalTokens, turnsSince, sessionID: realSid2 });
          await triggerNativeCompaction(realSid2);
          resetTurnsSinceCompaction(sessionID);
        }
        for (let msgIdx = 0;msgIdx < output.messages.length; msgIdx++) {
          const m = output.messages[msgIdx];
          if (!Array.isArray(m.parts))
            continue;
          for (const part of m.parts) {
            if (part.type === "text" && typeof part.text === "string") {
              part.text = stripCompactionSignal(part.text);
            }
          }
          const role = m.info?.role;
          const hasNonEmptyText = m.parts.some((p) => p.type === "text" && typeof p.text === "string" && p.text.length > 0);
          const hasToolCall = m.parts.some((p) => p.type === "tool-call" || p.type === "tool_call");
          if (role === "assistant" && !hasNonEmptyText && !hasToolCall) {
            const state = getCompactionState(sessionID);
            const reason = state.lastSignal?.reason ?? "";
            m.parts.push({ type: "text", text: reason ? `\u2026 [compacted: ${reason}]` : "\u2026 [compacted]" });
            logDebugEvent("compaction.guard.placeholder_injected", { partCount: m.parts.length });
          }
        }
        clearSignal(sessionID);
        clearTransformState(sessionID);
      } catch {}
    }
  };
};
var four_opencode_context_curator_default = FourContextCuratorPlugin;
export {
  four_opencode_context_curator_default as default,
  FourContextCuratorPlugin
};
