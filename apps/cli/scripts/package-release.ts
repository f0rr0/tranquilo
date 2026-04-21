import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { RELEASE_METADATA } from "@tranquilo/cli-model/release-metadata";
import { execa } from "execa";

export type PackageMode = "current" | "pr" | "release";

type ReleaseTarget = (typeof RELEASE_METADATA.releaseTargets)[number];

async function sha256(file: string): Promise<string> {
  const hash = createHash("sha256");
  hash.update(await fs.readFile(file));
  return hash.digest("hex");
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function archiveTarget(
  target: ReleaseTarget,
  outDir: string
): Promise<string> {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "tranquilo-pkg-"));
  try {
    const binary = target.os === "win32" ? "tranquilo.exe" : "tranquilo";
    const binaryPath = path.join(workDir, binary);
    await execa("bun", [
      "build",
      "--compile",
      `--target=${target.bunTarget}`,
      "src/index.ts",
      "--outfile",
      binaryPath,
    ]);

    await fs.cp("assets", path.join(workDir, "assets"), { recursive: true });
    await fs.cp("mcpb", path.join(workDir, "mcpb"), { recursive: true });

    const archive = path.join(outDir, RELEASE_METADATA.archiveName(target));
    if (target.os === "win32") {
      await execa("zip", ["-q", "-r", archive, binary, "assets", "mcpb"], {
        cwd: workDir,
      });
    } else {
      await execa("tar", [
        "-czf",
        archive,
        "-C",
        workDir,
        binary,
        "assets",
        "mcpb",
      ]);
    }
    return archive;
  } finally {
    await fs.rm(workDir, { force: true, recursive: true });
  }
}

export async function packageRelease(options: {
  mode: PackageMode;
  outDir: string;
  smoke?: boolean | undefined;
}): Promise<{ archives: string[]; checksumsPath: string }> {
  const outDir = path.resolve(options.outDir);
  await fs.rm(outDir, { force: true, recursive: true });
  await fs.mkdir(outDir, { recursive: true });

  const archives: string[] = [];
  for (const target of RELEASE_METADATA.targetsForMode(options.mode)) {
    archives.push(await archiveTarget(target, outDir));
  }

  const lines: string[] = [];
  for (const archive of archives) {
    lines.push(`${await sha256(archive)}  ${path.basename(archive)}`);
  }
  const checksumsPath = path.join(outDir, "checksums.txt");
  await fs.writeFile(checksumsPath, `${lines.join("\n")}\n`);

  if (options.smoke) {
    await smokeCurrentBinary(outDir);
  }

  return { archives, checksumsPath };
}

async function smokeCurrentBinary(outDir: string): Promise<void> {
  const [current] = RELEASE_METADATA.targetsForMode("current");
  if (!current) {
    throw new Error("No current-platform release target found.");
  }
  const archive = path.join(outDir, RELEASE_METADATA.archiveName(current));
  if (!(await fileExists(archive))) {
    console.warn(
      `Skipping smoke test because ${path.basename(archive)} was not packaged for this mode.`
    );
    return;
  }
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "tranquilo-smoke-"));
  try {
    if (current.os === "win32") {
      throw new Error("Smoke tests for Windows packages must run on Windows.");
    }
    await execa("tar", ["-xzf", archive, "-C", workDir]);
    await execa(path.join(workDir, "tranquilo"), ["doctor"], {
      env: {
        ...process.env,
        TRANQUILO_CONFIG_DIR: path.join(workDir, "config"),
        TRANQUILO_STATE_DIR: path.join(workDir, "state"),
      },
    });
  } finally {
    await fs.rm(workDir, { force: true, recursive: true });
  }
}

function argValue(name: string, fallback?: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

if (import.meta.main) {
  const mode = (argValue("mode", "release") ?? "release") as PackageMode;
  const outDir = argValue("out", "dist-release") ?? "dist-release";
  const smoke = process.argv.includes("--smoke");
  await packageRelease({ mode, outDir, smoke });
}
