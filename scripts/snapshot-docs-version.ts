import fs from "node:fs/promises";
import path from "node:path";
import { PACKAGE_METADATA } from "../packages/product/src/release-metadata";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const tag = PACKAGE_METADATA.version.startsWith("v")
  ? PACKAGE_METADATA.version
  : `v${PACKAGE_METADATA.version}`;
const force = process.argv.includes("--force");

const source = path.join(root, "apps/docs/latest");
const target = path.join(root, "apps/docs/versions", tag);

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
    if (!entry.name.endsWith(".mdx")) {
      continue;
    }
    const content = await fs.readFile(file, "utf8");
    const rewritten = content
      .replaceAll('href="/latest/', `href="/versions/${tag}/`)
      .replaceAll("](/latest/", `](/versions/${tag}/`);
    if (rewritten !== content) {
      await fs.writeFile(file, rewritten);
    }
  }
}

await rewriteVersionLinks(target);
