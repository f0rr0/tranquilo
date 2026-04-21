import fs from "node:fs/promises";
import path from "node:path";
import { PACKAGE_METADATA } from "../packages/cli-model/src/release-metadata";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const tag = PACKAGE_METADATA.version.startsWith("v")
  ? PACKAGE_METADATA.version
  : `v${PACKAGE_METADATA.version}`;
const force = process.argv.includes("--force");

const source = path.join(root, "packages/docs-content/latest");
const target = path.join(root, "packages/docs-content/versions", tag);
const LATEST_INSTALL_COMMAND_RE =
  /curl -fsSL (?<origin>https?:\/\/[^/\s]+)\/install\.sh \| sh/gu;

try {
  await fs.access(target);
  if (!force) {
    throw new Error(
      `${path.relative(root, target)} already exists. Use --force to replace it.`
    );
  }
  await fs.rm(target, { force: true, recursive: true });
} catch (error) {
  if (error instanceof Error && "code" in error && error.code !== "ENOENT") {
    throw error;
  }
}

await fs.mkdir(path.dirname(target), { recursive: true });
await fs.cp(source, target, { recursive: true });

async function rewriteVersionLinks(dir: string): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await rewriteVersionLinks(file);
      continue;
    }
    if (!entry.name.endsWith(".mdx") && entry.name !== "meta.json") {
      continue;
    }
    const content = await fs.readFile(file, "utf8");
    const rewritten = content
      .replaceAll('href="/docs/latest/', `href="/docs/versions/${tag}/`)
      .replaceAll("](/docs/latest/", `](/docs/versions/${tag}/`)
      .replace(
        LATEST_INSTALL_COMMAND_RE,
        (_command: string, origin: string) =>
          `curl -fsSL ${origin}/releases/${tag}/install.sh | sh`
      )
      .replaceAll("Latest CLI version:", "CLI version:")
      .replace('"title": "Latest"', `"title": "${tag}"`);
    if (rewritten !== content) {
      await fs.writeFile(file, rewritten);
    }
  }
}

await rewriteVersionLinks(target);
