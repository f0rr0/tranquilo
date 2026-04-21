import fs from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";

function argValue(name: string, fallback?: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

async function packageVersion(): Promise<string> {
  const pkg = JSON.parse(await fs.readFile("package.json", "utf8")) as {
    version?: string | undefined;
  };
  if (!pkg.version) {
    throw new Error("package.json is missing a version.");
  }
  return pkg.version;
}

async function releaseExists(tag: string): Promise<boolean> {
  const result = await execa("gh", ["release", "view", tag], {
    reject: false,
  });
  return result.exitCode === 0;
}

export async function releaseGitHub(options: {
  dir: string;
  version?: string | undefined;
}): Promise<void> {
  const version = options.version ?? (await packageVersion());
  const tag = version.startsWith("v") ? version : `v${version}`;
  const dir = path.resolve(options.dir);
  const entries = await fs.readdir(dir);
  const assets = entries
    .filter((entry) => !entry.startsWith("."))
    .sort()
    .map((entry) => path.join(dir, entry));
  if (assets.length === 0) {
    throw new Error(`No release assets found in ${dir}.`);
  }

  if (await releaseExists(tag)) {
    await execa("gh", ["release", "upload", tag, ...assets, "--clobber"], {
      stdio: "inherit",
    });
    return;
  }

  await execa(
    "gh",
    [
      "release",
      "create",
      tag,
      ...assets,
      "--title",
      tag,
      "--generate-notes",
      "--latest",
    ],
    { stdio: "inherit" }
  );
}

if (import.meta.main) {
  await releaseGitHub({
    dir: argValue("dir", "dist-release") ?? "dist-release",
    version: argValue("version"),
  });
}
