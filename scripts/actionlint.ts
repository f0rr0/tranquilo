import fs from "node:fs/promises";
import path from "node:path";
import { createLinter } from "actionlint";

const WORKFLOWS_DIR = path.join(".github", "workflows");
const WORKFLOW_FILE_RE = /\.(ya?ml)$/i;

async function workflowFiles(dir = WORKFLOWS_DIR): Promise<string[]> {
  const entries = await fs
    .readdir(dir, { withFileTypes: true })
    .catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const item = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await workflowFiles(item)));
      continue;
    }
    if (WORKFLOW_FILE_RE.test(entry.name)) {
      files.push(item);
    }
  }
  return files.sort();
}

if (import.meta.main) {
  const files = await workflowFiles();
  let errors = 0;

  for (const file of files) {
    const linter = await createLinter();
    const source = await fs.readFile(file, "utf8");
    const results = linter(source, file);
    for (const result of results) {
      errors += 1;
      console.error(
        `${result.file}:${result.line}:${result.column}: ${result.kind}: ${result.message}`
      );
    }
  }

  if (errors > 0) {
    process.exit(1);
  }
}
