import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

interface ReleaseMetadata {
  docsUrl?: string;
}

function generatedRelease(): ReleaseMetadata {
  try {
    const configDir = path.dirname(fileURLToPath(import.meta.url));
    const releasePath = path.join(configDir, "../generated/release.json");
    return JSON.parse(fs.readFileSync(releasePath, "utf8")) as ReleaseMetadata;
  } catch {
    return {};
  }
}

export function latestDocsPath(): string {
  const docsUrl = generatedRelease().docsUrl;
  if (!docsUrl) {
    return "/docs/latest";
  }
  try {
    return new URL(docsUrl).pathname;
  } catch {
    return "/docs/latest";
  }
}
