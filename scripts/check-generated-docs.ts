import { execa } from "execa";

const DOC_PATHS = [
  "packages/docs-content/meta.json",
  "packages/docs-content/latest",
  "packages/docs-content/versions",
  "packages/docs-content/llms.txt",
  "packages/docs-content/skill.md",
] as const;

await execa("bun", ["run", "generate"], { stdio: "inherit" });

const { stdout } = await execa("git", [
  "status",
  "--porcelain",
  "--",
  ...DOC_PATHS,
]);

if (stdout.trim()) {
  console.error(
    "Generated Fumadocs content is out of sync. Run `bun run generate` and commit the packages/docs-content changes."
  );
  console.error(stdout);
  process.exit(1);
}
