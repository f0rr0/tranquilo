import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

interface ReleaseMetadata {
  docsUrl?: string;
  version?: string;
}

const TRAILING_SLASH_RE = /\/+$/;

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
  return resolveLatestDocsPath(generatedRelease());
}

export function resolveLatestDocsPath(release: ReleaseMetadata): string {
  const fallbackPath = release.version
    ? `/docs/versions/v${release.version}`
    : "/";
  const docsUrl = release.docsUrl;
  if (!docsUrl) {
    return fallbackPath;
  }

  try {
    const pathname = new URL(
      docsUrl,
      "https://tranquilo-ai.vercel.app"
    ).pathname.replace(TRAILING_SLASH_RE, "");
    if (pathname === "/docs" || pathname === "/docs/latest") {
      return fallbackPath;
    }
    return pathname || fallbackPath;
  } catch {
    return fallbackPath;
  }
}
