import release from "../../../../generated/release.json";

export const dynamic = "force-dynamic";

const VERSION_PREFIX_RE = /^v/;

function compareVersion(left: string, right: string): number {
  const leftParts = left.replace(VERSION_PREFIX_RE, "").split(".").map(Number);
  const rightParts = right
    .replace(VERSION_PREFIX_RE, "")
    .split(".")
    .map(Number);
  for (let index = 0; index < 3; index += 1) {
    const diff = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

export function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const current = searchParams.get("version") ?? "0.0.0";
  const updateAvailable = compareVersion(release.version, current) > 0;
  return Response.json({
    currentVersion: current,
    latestVersion: release.version,
    updateAvailable,
    installCommand: release.installCommand,
    releaseNotesUrl: release.releaseNotesUrl,
    docsUrl: release.docsUrl,
    supportedPlatforms: release.supportedPlatforms,
  });
}
