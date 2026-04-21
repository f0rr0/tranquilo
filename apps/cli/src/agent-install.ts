import { spawnSync } from "node:child_process";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dataDir } from "./paths";
import type { JsonObject } from "./types";

function home(): string {
  return process.env.HOME || process.env.USERPROFILE || os.homedir();
}

function packageRoot(): string {
  const explicit = process.env.TRANQUILO_PACKAGE_ROOT;
  if (explicit) {
    return explicit;
  }
  const sourceRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    ".."
  );
  if (fsSync.existsSync(path.join(sourceRoot, "assets"))) {
    return sourceRoot;
  }
  return path.join(dataDir(), "package");
}

function mcpCommand(): string[] {
  const explicit = process.env.TRANQUILO_MCP_COMMAND;
  if (explicit) {
    return [explicit, "mcp"];
  }
  const entry = process.argv[1];
  if (entry?.endsWith("/src/index.ts") || entry === "src/index.ts") {
    return [process.argv[0] ?? "tranquilo", entry, "mcp"];
  }
  const execPath = process.execPath;
  if (["tranquilo", "tranquilo.exe"].includes(path.basename(execPath))) {
    return [execPath, "mcp"];
  }
  return ["tranquilo", "mcp"];
}

async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(from, to);
    } else {
      await fs.copyFile(from, to);
    }
  }
}

function runIfAvailable(
  command: string,
  args: string[]
): { ok: boolean; skipped?: string | undefined; stderr?: string | undefined } {
  const check = spawnSync(command, ["--version"], { encoding: "utf8" });
  if (check.error) {
    return { ok: false, skipped: `${command} not found` };
  }
  const result = spawnSync(command, args, { encoding: "utf8" });
  return {
    ok: result.status === 0,
    stderr: result.stderr || result.stdout || undefined,
  };
}

function commandAvailable(command: string): boolean {
  return !spawnSync(command, ["--version"], { encoding: "utf8" }).error;
}

function pathExists(item: string): boolean {
  return fsSync.existsSync(item);
}

function detectAutoTargets(): string[] {
  const targets: string[] = [];
  if (
    commandAvailable("codex") ||
    pathExists(path.join(home(), ".codex")) ||
    pathExists(path.join(home(), ".agents"))
  ) {
    targets.push("codex");
  }
  if (commandAvailable("claude") || pathExists(path.join(home(), ".claude"))) {
    targets.push("claude-code");
  }
  return targets;
}

async function installCodex(): Promise<JsonObject> {
  const skillSrc = path.join(packageRoot(), "assets", "codex-skill");
  const skillDest = path.join(home(), ".agents", "skills", "tranquilo");
  await copyDir(skillSrc, skillDest);
  const command = mcpCommand();
  const mcp = runIfAvailable("codex", [
    "mcp",
    "add",
    "tranquilo",
    "--",
    ...command,
  ]);
  return { skill: skillDest, mcp };
}

async function installClaudeCode(): Promise<JsonObject> {
  const commandsSrc = path.join(
    packageRoot(),
    "assets",
    "claude-commands",
    "tranquilo"
  );
  const commandsDest = path.join(home(), ".claude", "commands", "tranquilo");
  await copyDir(commandsSrc, commandsDest);
  const command = mcpCommand();
  const mcp = runIfAvailable("claude", [
    "mcp",
    "add",
    "tranquilo",
    "--scope",
    "user",
    "--",
    ...command,
  ]);
  return { commands: commandsDest, mcp };
}

async function installClaudeDesktop(): Promise<JsonObject> {
  const bundleSrc = path.join(packageRoot(), "mcpb");
  const bundleDest = path.join(home(), ".tranquilo", "claude-desktop-mcpb");
  await copyDir(bundleSrc, bundleDest);
  return {
    bundle: bundleDest,
    nextStep:
      "For local MCPB packing only, install @anthropic-ai/mcpb and run `mcpb pack` in this directory. Prefer the prebuilt .mcpb from releases.",
  };
}

export async function installAgent(target: string): Promise<JsonObject> {
  if (target === "auto") {
    const targets = detectAutoTargets();
    const result: JsonObject = { detected: targets };
    if (targets.includes("codex")) {
      result.codex = await installCodex();
    }
    if (targets.includes("claude-code")) {
      result.claudeCode = await installClaudeCode();
    }
    if (targets.length === 0) {
      result.skipped =
        "No Codex or Claude Code installation was detected. Run `tranquilo install-agent codex` or `tranquilo install-agent claude-code` after installing an AI client.";
    }
    return result;
  }
  if (target === "codex") {
    return { codex: await installCodex() };
  }
  if (target === "claude-code") {
    return { claudeCode: await installClaudeCode() };
  }
  if (target === "claude-desktop") {
    return { claudeDesktop: await installClaudeDesktop() };
  }
  if (target === "all") {
    return {
      codex: await installCodex(),
      claudeCode: await installClaudeCode(),
      claudeDesktop: await installClaudeDesktop(),
    };
  }
  throw new Error(`Unknown agent target: ${target}`);
}
