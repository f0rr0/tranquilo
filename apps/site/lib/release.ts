import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

interface ReleaseMetadata {
  docsUrl?: string;
  version?: string;
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
  const release = generatedRelease();
  const docsUrl = release.docsUrl;
  if (!docsUrl) {
    return release.version ? `/docs/versions/v${release.version}` : "/docs";
  }
  try {
    return new URL(docsUrl).pathname;
  } catch {
    return release.version ? `/docs/versions/v${release.version}` : "/docs";
  }
}
