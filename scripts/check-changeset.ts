import { execa } from "execa";

const CHANGESET_RE = /^\.changeset\/(?!config\.json$|README\.md$).+\.md$/;
const NON_RELEASABLE_RE =
  /^(README\.md$|\.gitignore$|biome\.jsonc$|lefthook\.yml$|tsconfig(?:\.base)?\.json$|apps\/cli\/tests\/|apps\/cli\/fixtures\/|apps\/.*\/.*\.test\.ts$)/;
const RELEASABLE_RE =
  /^(apps\/cli\/src\/|apps\/cli\/scripts\/|apps\/cli\/assets\/|apps\/cli\/mcpb\/|apps\/cli\/package\.json$|packages\/product\/src\/(agent-catalog|release-metadata)\.ts$)/;

async function changedFiles(): Promise<string[]> {
  const base = process.env.CHANGESET_BASE_REF;
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

export function needsChangeset(files: string[]): boolean {
  return files.some(
    (file) => RELEASABLE_RE.test(file) && !NON_RELEASABLE_RE.test(file)
  );
}

export function hasChangeset(files: string[]): boolean {
  return files.some((file) => CHANGESET_RE.test(file));
}

export function shouldRequireChangeset(
  files: string[],
  releaseTagsExist: boolean
): boolean {
  return releaseTagsExist && needsChangeset(files) && !hasChangeset(files);
}

async function hasReleaseTag(): Promise<boolean> {
  const { stdout } = await execa("git", ["tag", "--list", "v[0-9]*"]).catch(
    () => ({ stdout: "" })
  );
  return stdout.trim().length > 0;
}

if (import.meta.main) {
  const files = await changedFiles();
  if (shouldRequireChangeset(files, await hasReleaseTag())) {
    console.error(
      [
        "This PR changes releasable Tranquilo files but does not include a changeset.",
        "Run `bunx changeset` and choose patch/minor/major, or add an explicit no-release changeset for internal-only changes.",
      ].join("\n")
    );
    process.exit(1);
  }
}
