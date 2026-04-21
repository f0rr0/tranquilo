import { unzipSync } from "fflate";
import { RELEASE_METADATA } from "./release-metadata";

interface InstallRouteEnv {
  fetch?: typeof fetch | undefined;
  GITHUB_OWNER?: string | undefined;
  GITHUB_REPO?: string | undefined;
  GITHUB_REPOSITORY?: string | undefined;
  GITHUB_TOKEN?: string | undefined;
  PUBLIC_INSTALL_BASE_URL?: string | undefined;
  VERCEL_GIT_REPO_OWNER?: string | undefined;
  VERCEL_GIT_REPO_SLUG?: string | undefined;
  VERCEL_PROJECT_PRODUCTION_URL?: string | undefined;
  VERCEL_URL?: string | undefined;
}

interface InstallRouteRequest {
  method?: string | undefined;
  origin?: string | undefined;
  path: string;
}

interface InstallRouteResponse {
  body: string | Uint8Array;
  headers: Record<string, string>;
  status: number;
}

interface GitHubAsset {
  browser_download_url?: string | undefined;
  name?: string | undefined;
}

interface GitHubArtifact {
  archive_download_url?: string | undefined;
  created_at?: string | undefined;
  expired?: boolean | undefined;
  name?: string | undefined;
}

const DEFAULT_BASE_URL = "https://tranquilo-ai.vercel.app";
const DEFAULT_GITHUB_OWNER = "f0rr0";
const DEFAULT_GITHUB_REPO = "tranquilo";
const GITHUB_API_VERSION = "2022-11-28";
const PROTOCOL_RE = /^https?:\/\//u;
const PR_ASSET_NAMES = new Set([
  ...RELEASE_METADATA.releaseAssetNames(RELEASE_METADATA.prTargets),
  "checksums.txt",
]);
const TRAILING_SLASH_RE = /\/+$/u;

function textResponse(
  status: number,
  body: string,
  contentType = "text/plain; charset=utf-8"
): InstallRouteResponse {
  return { body, headers: { "content-type": contentType }, status };
}

function redirect(location: string): InstallRouteResponse {
  return { body: "", headers: { location }, status: 302 };
}

function binaryResponse(
  status: number,
  body: Uint8Array,
  contentType: string
): InstallRouteResponse {
  return {
    body,
    headers: {
      "content-length": String(body.byteLength),
      "content-type": contentType,
    },
    status,
  };
}

function assetContentType(assetName: string): string {
  if (assetName.endsWith(".tar.gz")) {
    return "application/gzip";
  }
  if (assetName.endsWith(".zip")) {
    return "application/zip";
  }
  return "text/plain; charset=utf-8";
}

function urlWithProtocol(value: string): string {
  return PROTOCOL_RE.test(value) ? value : `https://${value}`;
}

function trimTrailingSlash(value: string): string {
  return value.replace(TRAILING_SLASH_RE, "");
}

function baseUrl(env: InstallRouteEnv, requestOrigin?: string): string {
  const value =
    env.PUBLIC_INSTALL_BASE_URL ??
    requestOrigin ??
    env.VERCEL_PROJECT_PRODUCTION_URL ??
    env.VERCEL_URL ??
    DEFAULT_BASE_URL;
  return trimTrailingSlash(urlWithProtocol(value));
}

function repository(env: InstallRouteEnv): {
  owner: string | undefined;
  repo: string | undefined;
} {
  if (env.GITHUB_OWNER && env.GITHUB_REPO) {
    return { owner: env.GITHUB_OWNER, repo: env.GITHUB_REPO };
  }
  if (env.GITHUB_REPOSITORY) {
    const [owner, repo] = env.GITHUB_REPOSITORY.split("/");
    return { owner, repo };
  }
  return {
    owner: env.VERCEL_GIT_REPO_OWNER ?? DEFAULT_GITHUB_OWNER,
    repo: env.VERCEL_GIT_REPO_SLUG ?? DEFAULT_GITHUB_REPO,
  };
}

function html(baseUrl: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Tranquilo</title>
</head>
<body>
  <main>
    <h1>Tranquilo</h1>
    <p>CLI and local MCP server for Pronto House Help booking flows.</p>
    <h2>Install</h2>
    <pre><code>curl -fsSL ${baseUrl}/install.sh | sh</code></pre>
  </main>
</body>
</html>
`;
}

/** @internal White-box tested installer renderer. */
export function renderInstallSh(options: {
  baseUrl: string;
  prMacOnly?: boolean | undefined;
}): string {
  const prMacOnly = options.prMacOnly ? "1" : "0";
  return `#!/usr/bin/env sh
set -eu

DEFAULT_BASE_URL="${options.baseUrl}"
BASE_URL="\${TRANQUILO_INSTALL_BASE:-$DEFAULT_BASE_URL}"
BIN_DIR="\${TRANQUILO_BIN_DIR:-$HOME/.local/bin}"
PR_MAC_ONLY="\${TRANQUILO_PR_MAC_ONLY:-${prMacOnly}}"
AGENT_TARGET="\${TRANQUILO_INSTALL_AGENT_TARGET:-auto}"
SKIP_AGENT_INSTALL="\${TRANQUILO_SKIP_AGENT_INSTALL:-0}"
TMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

uname_s="$(uname -s)"
uname_m="$(uname -m)"

case "$uname_s" in
  Darwin)
    os="darwin"
    binary="tranquilo"
    DEFAULT_PACKAGE_ROOT="$HOME/Library/Application Support/tranquilo/package"
    ;;
  Linux)
    os="linux"
    binary="tranquilo"
    DEFAULT_PACKAGE_ROOT="\${XDG_DATA_HOME:-$HOME/.local/share}/tranquilo/package"
    ;;
  MINGW*|MSYS*|CYGWIN*)
    os="win32"
    binary="tranquilo.exe"
    DEFAULT_PACKAGE_ROOT="$HOME/AppData/Local/Tranquilo/package"
    ;;
  *) echo "Unsupported OS: $uname_s" >&2; exit 1 ;;
esac
PACKAGE_ROOT="\${TRANQUILO_PACKAGE_ROOT:-$DEFAULT_PACKAGE_ROOT}"

if [ "$PR_MAC_ONLY" = "1" ] && [ "$os" != "darwin" ]; then
  echo "PR preview installs only support macOS. Use a main release for Linux or Windows." >&2
  exit 1
fi

case "$uname_m" in
  x86_64|amd64) arch="x64" ;;
  arm64|aarch64) arch="arm64" ;;
  *) echo "Unsupported architecture: $uname_m" >&2; exit 1 ;;
esac

if [ "$os" = "win32" ]; then
  archive="tranquilo-win32-\${arch}.zip"
else
  archive="tranquilo-\${os}-\${arch}.tar.gz"
fi
url="\${BASE_URL}/\${archive}"
checksum_url="\${BASE_URL}/checksums.txt"

mkdir -p "$BIN_DIR"
echo "Downloading $url"
curl -fsSL "$url" -o "$TMP_DIR/$archive"
curl -fsSL "$checksum_url" -o "$TMP_DIR/checksums.txt"

expected="$(grep "  $archive\\$" "$TMP_DIR/checksums.txt" | awk '{print $1}')"
if [ -z "$expected" ]; then
  echo "Checksum entry missing for $archive" >&2
  exit 1
fi
if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "$TMP_DIR/$archive" | awk '{print $1}')"
else
  actual="$(shasum -a 256 "$TMP_DIR/$archive" | awk '{print $1}')"
fi
if [ "$expected" != "$actual" ]; then
  echo "Checksum mismatch for $archive" >&2
  exit 1
fi

if [ "$os" = "win32" ]; then
  if ! command -v unzip >/dev/null 2>&1; then
    echo "Windows bash install requires unzip. Install unzip and rerun this command." >&2
    exit 1
  fi
  unzip -q "$TMP_DIR/$archive" -d "$TMP_DIR"
else
  tar -xzf "$TMP_DIR/$archive" -C "$TMP_DIR"
fi
if command -v install >/dev/null 2>&1; then
  install -m 0755 "$TMP_DIR/$binary" "$BIN_DIR/$binary"
else
  cp "$TMP_DIR/$binary" "$BIN_DIR/$binary"
  chmod 0755 "$BIN_DIR/$binary"
fi
mkdir -p "$PACKAGE_ROOT"
rm -rf "$PACKAGE_ROOT/assets" "$PACKAGE_ROOT/mcpb"
cp -R "$TMP_DIR/assets" "$PACKAGE_ROOT/assets"
cp -R "$TMP_DIR/mcpb" "$PACKAGE_ROOT/mcpb"

installed="$BIN_DIR/$binary"
echo "Installed tranquilo to $installed"
if ! command -v tranquilo >/dev/null 2>&1 && ! command -v tranquilo.exe >/dev/null 2>&1; then
  echo "Add $BIN_DIR to PATH to use tranquilo from any shell."
fi

"$installed" doctor || true
if [ "$SKIP_AGENT_INSTALL" != "1" ]; then
  echo "Configuring AI integrations ($AGENT_TARGET)"
  TRANQUILO_PACKAGE_ROOT="$PACKAGE_ROOT" TRANQUILO_MCP_COMMAND="$installed" "$installed" install-agent "$AGENT_TARGET" || {
    echo "AI integration setup was skipped or failed. You can retry with: $installed install-agent auto" >&2
  }
fi
`;
}

function githubContext(
  env: InstallRouteEnv,
  options: { requireToken?: boolean } = {}
): {
  fetch: typeof fetch;
  owner: string;
  repo: string;
  token: string | undefined;
} {
  const { owner, repo } = repository(env);
  const token = env.GITHUB_TOKEN;
  if (!(owner && repo)) {
    throw new Error("Missing GitHub repository metadata.");
  }
  if (options.requireToken && !token) {
    throw new Error("Missing GITHUB_TOKEN for GitHub Actions artifacts.");
  }
  return { fetch: env.fetch ?? fetch, owner, repo, token };
}

function githubHeaders(token?: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "x-github-api-version": GITHUB_API_VERSION,
  };
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  return headers;
}

async function githubJson<T>(
  env: InstallRouteEnv,
  pathname: string,
  options: { requireToken?: boolean } = {}
): Promise<T> {
  const { fetch: fetchImpl, owner, repo, token } = githubContext(env, options);
  const response = await fetchImpl(
    `https://api.github.com/repos/${owner}/${repo}${pathname}`,
    { headers: githubHeaders(token) }
  );
  if (!response.ok) {
    throw new Error(`GitHub API failed with HTTP ${response.status}.`);
  }
  return (await response.json()) as T;
}

async function releaseAsset(
  env: InstallRouteEnv,
  version: string,
  assetName: string
): Promise<InstallRouteResponse> {
  const releasePath =
    version === "latest" ? "/releases/latest" : `/releases/tags/${version}`;
  const release = await githubJson<{ assets?: GitHubAsset[] }>(
    env,
    releasePath
  );
  const asset = release.assets?.find((item) => item.name === assetName);
  if (!asset?.browser_download_url) {
    return textResponse(404, `Release asset not found: ${assetName}\n`);
  }
  return redirect(asset.browser_download_url);
}

async function artifactAsset(
  env: InstallRouteEnv,
  artifact: GitHubArtifact,
  assetName: string
): Promise<InstallRouteResponse> {
  if (!artifact.archive_download_url) {
    throw new Error("Artifact is missing archive_download_url.");
  }
  const { fetch: fetchImpl, token } = githubContext(env, {
    requireToken: true,
  });
  const response = await fetchImpl(artifact.archive_download_url, {
    headers: githubHeaders(token),
    redirect: "follow",
  });
  if (!response.ok) {
    throw new Error(`Artifact download failed with HTTP ${response.status}.`);
  }
  const zip = unzipSync(new Uint8Array(await response.arrayBuffer()));
  const entry = Object.entries(zip).find(
    ([name]) => name === assetName || name.endsWith(`/${assetName}`)
  );
  const body = entry?.[1];
  if (!body) {
    const fallbackEntry = Object.entries(zip).find(([name]) =>
      name.endsWith(assetName)
    );
    if (fallbackEntry) {
      return binaryResponse(200, fallbackEntry[1], assetContentType(assetName));
    }
    return textResponse(404, `PR artifact zip did not contain: ${assetName}\n`);
  }
  return binaryResponse(200, body, assetContentType(assetName));
}

async function prArtifact(
  env: InstallRouteEnv,
  pr: string,
  shaOrLatest: string,
  assetName: string
): Promise<InstallRouteResponse> {
  if (!PR_ASSET_NAMES.has(assetName)) {
    return textResponse(
      400,
      "PR preview installs only support macOS artifacts.\n"
    );
  }
  const payload = await githubJson<{ artifacts?: GitHubArtifact[] }>(
    env,
    "/actions/artifacts?per_page=100",
    { requireToken: true }
  );
  const prefix =
    shaOrLatest === "latest"
      ? `tranquilo-pr-${pr}-`
      : `tranquilo-pr-${pr}-${shaOrLatest}-`;
  const artifact = (payload.artifacts ?? [])
    .filter(
      (item) =>
        !item.expired &&
        item.name?.startsWith(prefix) &&
        item.name.endsWith(`-${assetName}`)
    )
    .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))[0];
  if (!artifact) {
    return textResponse(404, `PR artifact not found: ${assetName}\n`);
  }
  return artifactAsset(env, artifact, assetName);
}

export async function handleInstallRoute(
  request: InstallRouteRequest,
  env: InstallRouteEnv = process.env as InstallRouteEnv
): Promise<InstallRouteResponse> {
  if (request.method && !["GET", "HEAD"].includes(request.method)) {
    return textResponse(405, "Method not allowed.\n");
  }
  const installBaseUrl = baseUrl(env, request.origin);
  const path = request.path.replace(/^\/+|\/+$/g, "");
  if (!path) {
    return textResponse(200, html(installBaseUrl), "text/html; charset=utf-8");
  }
  if (path === "install.sh") {
    return textResponse(
      200,
      renderInstallSh({ baseUrl: `${installBaseUrl}/releases/latest` }),
      "text/x-shellscript; charset=utf-8"
    );
  }
  const parts = path.split("/");
  try {
    const [section, first, second, third] = parts;
    if (
      section === "releases" &&
      first &&
      second === "install.sh" &&
      parts.length === 3
    ) {
      return textResponse(
        200,
        renderInstallSh({ baseUrl: `${installBaseUrl}/releases/${first}` }),
        "text/x-shellscript; charset=utf-8"
      );
    }
    if (section === "releases" && first && second && parts.length === 3) {
      return await releaseAsset(env, first, second);
    }
    if (
      section === "pr" &&
      first &&
      parts.length === 3 &&
      second === "install.sh"
    ) {
      return textResponse(
        200,
        renderInstallSh({
          baseUrl: `${installBaseUrl}/pr/${first}/latest`,
          prMacOnly: true,
        }),
        "text/x-shellscript; charset=utf-8"
      );
    }
    if (section === "pr" && first && second && third && parts.length === 4) {
      return await prArtifact(env, first, second, third);
    }
  } catch (error) {
    return textResponse(
      502,
      `${error instanceof Error ? error.message : String(error)}\n`
    );
  }
  return textResponse(404, "Not found.\n");
}
