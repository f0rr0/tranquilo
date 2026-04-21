import packageJson from "../../../apps/cli/package.json" with { type: "json" };

const RELEASE_OSES = ["darwin", "linux", "win32"] as const;
const RELEASE_ARCHES = ["arm64", "x64"] as const;

type ReleaseOs = (typeof RELEASE_OSES)[number];
type ReleaseArch = (typeof RELEASE_ARCHES)[number];

interface ReleaseTarget {
  arch: ReleaseArch;
  bunTarget: string;
  os: ReleaseOs;
}

function isReleaseOs(value: unknown): value is ReleaseOs {
  return typeof value === "string" && RELEASE_OSES.includes(value as ReleaseOs);
}

function isReleaseArch(value: unknown): value is ReleaseArch {
  return (
    typeof value === "string" && RELEASE_ARCHES.includes(value as ReleaseArch)
  );
}

function packageRecord(): Record<string, unknown> {
  return packageJson as Record<string, unknown>;
}

function tranquiloRecord(): Record<string, unknown> {
  const tranquilo = packageRecord().tranquilo;
  if (!(tranquilo && typeof tranquilo === "object")) {
    throw new Error("package.json is missing tranquilo metadata.");
  }
  return tranquilo as Record<string, unknown>;
}

function releaseRecord(): Record<string, unknown> {
  const release = tranquiloRecord().release;
  if (!(release && typeof release === "object")) {
    throw new Error("package.json is missing tranquilo.release metadata.");
  }
  return release as Record<string, unknown>;
}

function mcpbRecord(): Record<string, unknown> {
  const mcpb = tranquiloRecord().mcpb;
  if (!(mcpb && typeof mcpb === "object")) {
    throw new Error("package.json is missing tranquilo.mcpb metadata.");
  }
  return mcpb as Record<string, unknown>;
}

function releaseTarget(value: unknown): ReleaseTarget {
  if (!(value && typeof value === "object")) {
    throw new Error("Invalid release target in package.json.");
  }
  const record = value as Record<string, unknown>;
  const { arch, bunTarget, os } = record;
  if (!isReleaseOs(os)) {
    throw new Error(`Invalid release target os: ${String(os)}`);
  }
  if (!isReleaseArch(arch)) {
    throw new Error(`Invalid release target arch: ${String(arch)}`);
  }
  if (typeof bunTarget !== "string" || !bunTarget) {
    throw new Error("Invalid release target bunTarget.");
  }
  return { arch, bunTarget, os };
}

function releaseTargets(key: "prTargets" | "targets"): ReleaseTarget[] {
  const value = releaseRecord()[key];
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`package.json tranquilo.release.${key} must be an array.`);
  }
  return value.map(releaseTarget);
}

function mcpbCompatibilityPlatforms(): ReleaseOs[] {
  const value = mcpbRecord().compatibilityPlatforms;
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(
      "package.json tranquilo.mcpb.compatibilityPlatforms must be an array."
    );
  }
  return value.map((platform) => {
    if (!isReleaseOs(platform)) {
      throw new Error(
        `Invalid MCPB compatibility platform: ${String(platform)}`
      );
    }
    return platform;
  });
}

function requiredPackageString(
  key: "description" | "name" | "version"
): string {
  const value = packageRecord()[key];
  if (typeof value !== "string" || !value) {
    throw new Error(`package.json is missing ${key}.`);
  }
  return value;
}

function requiredTranquiloString(key: "publicBaseUrl"): string {
  const value = tranquiloRecord()[key];
  if (typeof value !== "string" || !value) {
    throw new Error(`package.json is missing tranquilo.${key}.`);
  }
  return value;
}

export const PACKAGE_METADATA = {
  description: requiredPackageString("description"),
  name: requiredPackageString("name"),
  publicBaseUrl: requiredTranquiloString("publicBaseUrl"),
  version: requiredPackageString("version"),
} as const;

const PR_TARGETS = releaseTargets("prTargets");
const RELEASE_TARGETS = releaseTargets("targets");

const MCPB_METADATA = {
  compatibilityPlatforms: mcpbCompatibilityPlatforms(),
  dxtVersion: (() => {
    const value = mcpbRecord().dxtVersion;
    if (typeof value !== "string" || !value) {
      throw new Error("package.json is missing tranquilo.mcpb.dxtVersion.");
    }
    return value;
  })(),
} as const;

function archiveName(target: ReleaseTarget): string {
  return target.os === "win32"
    ? `${PACKAGE_METADATA.name}-win32-${target.arch}.zip`
    : `${PACKAGE_METADATA.name}-${target.os}-${target.arch}.tar.gz`;
}

function releaseAssetNames(targets: readonly ReleaseTarget[]): string[] {
  return targets.map(archiveName);
}

function tag(version = PACKAGE_METADATA.version): string {
  return version.startsWith("v") ? version : `v${version}`;
}

function targetsForMode(
  mode: "current" | "pr" | "release",
  platform = process.platform,
  arch = process.arch
): ReleaseTarget[] {
  if (mode === "release") {
    return RELEASE_TARGETS;
  }
  if (mode === "pr") {
    return PR_TARGETS;
  }
  const normalizedArch = arch === "x64" ? "x64" : "arm64";
  const current = RELEASE_TARGETS.find(
    (target) => target.os === platform && target.arch === normalizedArch
  );
  if (!current) {
    throw new Error(`Unsupported current package target: ${platform}-${arch}`);
  }
  return [current];
}

export const RELEASE_METADATA = {
  archiveName,
  mcpb: MCPB_METADATA,
  prTargets: PR_TARGETS,
  releaseAssetNames,
  releaseTargets: RELEASE_TARGETS,
  tag,
  targetsForMode,
} as const;
