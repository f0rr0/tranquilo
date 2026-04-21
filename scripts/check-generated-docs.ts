import { execa } from "execa";

const DOC_PATHS = [
  "apps/docs/docs.json",
  "apps/docs/latest",
  "apps/docs/versions",
  "apps/docs/llms.txt",
  "apps/docs/skill.md",
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
    "Generated Mintlify docs are out of sync. Run `bun run generate` and commit the apps/docs changes."
  );
  console.error(stdout);
  process.exit(1);
}
