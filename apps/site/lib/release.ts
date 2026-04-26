import release from "../generated/release.json";

interface ReleaseMetadata {
  docsUrl?: string;
  version?: string;
}

const TRAILING_SLASH_RE = /\/+$/;

export function latestDocsPath(): string {
  return resolveLatestDocsPath(release);
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
