import fs from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";

const CHANGESET_RE = /^\.changeset\/(?!config\.json$|README\.md$).+\.md$/;
const CHANGESET_FRONTMATTER_RE = /^---\n(?<body>[\s\S]*?)\n---/u;
const CHANGESET_PACKAGE_RE =
  /^\s*["']?([^"':\s][^"':]*)["']?\s*:\s*(?:major|minor|patch)\s*$/gmu;
const JSON_START_RE = /\{\s*"data"\s*:/u;
const TRANQUILO_PACKAGE = "tranquilo";
const CHANGESET_DIR = ".changeset";

interface AffectedPackage {
  name?: unknown;
}

interface TurboAffectedOutput {
  data?: {
    affectedPackages?: {
      items?: AffectedPackage[];
    };
  };
}

async function comparisonBase(): Promise<string | undefined> {
  if (process.env.CHANGESET_BASE_REF) {
    return process.env.CHANGESET_BASE_REF;
  }
  const result = await execa("git", ["rev-parse", "--verify", "origin/main"])
    .then(({ stdout }) => stdout.trim())
    .catch(() => "");
  return result || undefined;
}

async function changedFiles(base: string | undefined): Promise<string[]> {
  const head = process.env.CHANGESET_HEAD_REF ?? "HEAD";
  if (base) {
    const { stdout } = await execa("git", [
      "diff",
      "--name-only",
      `${base}...${head}`,
    ]);
    return stdout.split("\n").filter(Boolean);
  }
  const tracked = await execa("git", ["diff", "--name-only", "HEAD"])
    .then(({ stdout }) => stdout.split("\n").filter(Boolean))
    .catch(() => []);
  const untracked = await execa("git", [
    "ls-files",
    "--others",
    "--exclude-standard",
  ]).then(({ stdout }) => stdout.split("\n").filter(Boolean));
  return [...new Set([...tracked, ...untracked])];
}

function parseJsonFromTurboOutput(output: string): TurboAffectedOutput {
  const match = output.match(JSON_START_RE);
  if (!match?.index && match?.index !== 0) {
    throw new Error(`Turbo affected output did not contain JSON:\n${output}`);
  }
  return JSON.parse(output.slice(match.index)) as TurboAffectedOutput;
}

export function affectedPackageNames(output: string): string[] {
  const parsed = parseJsonFromTurboOutput(output);
  const items = parsed.data?.affectedPackages?.items ?? [];
  return items.flatMap((item) =>
    typeof item.name === "string" ? [item.name] : []
  );
}

export function hasChangeset(files: string[]): boolean {
  return files.some((file) => CHANGESET_RE.test(file));
}

async function existingChangesetFiles(
  files: readonly string[]
): Promise<string[]> {
  const changesets = files.filter((file) => CHANGESET_RE.test(file));
  const existing = await Promise.all(
    changesets.map(async (file) => {
      const exists = await fs
        .access(file)
        .then(() => true)
        .catch(() => false);
      return exists ? file : "";
    })
  );
  return existing.filter(Boolean);
}

export function changesetPackageNames(content: string): string[] {
  const frontmatter = content.match(CHANGESET_FRONTMATTER_RE)?.groups?.body;
  if (!frontmatter) {
    return [];
  }
  return [...frontmatter.matchAll(CHANGESET_PACKAGE_RE)].map(
    (match) => match[1] ?? ""
  );
}

export function invalidChangesetPackages(
  changesets: readonly { content: string; path: string }[]
): string[] {
  return changesets.flatMap((changeset) =>
    changesetPackageNames(changeset.content)
      .filter((packageName) => packageName !== TRANQUILO_PACKAGE)
      .map((packageName) => `${changeset.path}: ${packageName}`)
  );
}

export function isTranquiloAffected(packages: readonly string[]): boolean {
  return packages.includes(TRANQUILO_PACKAGE);
}

export function shouldRequireChangeset(
  affectedPackages: readonly string[],
  files: readonly string[]
): boolean {
  return isTranquiloAffected(affectedPackages) && !hasChangeset([...files]);
}

async function affectedPackages(base: string | undefined): Promise<string[]> {
  if (!base) {
    return [];
  }
  const head = process.env.CHANGESET_HEAD_REF ?? "HEAD";
  const { stdout } = await execa("bunx", [
    "turbo",
    "query",
    "affected",
    "--packages",
    "--base",
    base,
    "--head",
    head,
  ]);
  return affectedPackageNames(stdout);
}

async function validateChangesetsConfig(
  base: string | undefined
): Promise<void> {
  const args = ["changeset", "status"];
  if (base) {
    args.push("--since", base);
  }
  await execa("bunx", args, { stdio: "inherit" });
}

async function pendingChangesets(): Promise<
  Array<{ content: string; path: string }>
> {
  const entries = await fs.readdir(CHANGESET_DIR, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(CHANGESET_DIR, entry.name))
    .filter((file) => CHANGESET_RE.test(file));
  return await Promise.all(
    files.map(async (file) => ({
      content: await fs.readFile(file, "utf8"),
      path: file,
    }))
  );
}

if (import.meta.main) {
  const base = await comparisonBase();
  const invalidTargets = invalidChangesetPackages(await pendingChangesets());
  if (invalidTargets.length > 0) {
    console.error(
      [
        "Only the Tranquilo CLI package may be versioned by Changesets.",
        "Use `tranquilo` for releasable CLI changes, or an empty no-release changeset for intentional non-release work.",
        ...invalidTargets.map(
          (target) => `Invalid changeset target: ${target}`
        ),
      ].join("\n")
    );
    process.exit(1);
  }

  await validateChangesetsConfig(base);

  const [files, packages] = await Promise.all([
    changedFiles(base),
    affectedPackages(base),
  ]);
  const intentFiles = await existingChangesetFiles(files);

  if (shouldRequireChangeset(packages, intentFiles)) {
    console.error(
      [
        "This PR affects the Tranquilo CLI workspace but does not include a changeset.",
        "Add a normal changeset for CLI releases, or add an explicit empty no-release changeset for intentional non-release work.",
        "Example no-release changeset frontmatter:",
        "---",
        "---",
      ].join("\n")
    );
    process.exit(1);
  }
}
