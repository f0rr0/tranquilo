import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const MINTLIFY_ORIGIN = "https://personal-0b466684.mintlify.app";

interface ReleaseMetadata {
  docsUrl?: string;
}

function generatedRelease(): ReleaseMetadata {
  try {
    const configDir = path.dirname(fileURLToPath(import.meta.url));
    const releasePath = path.join(configDir, "generated/release.json");
    return JSON.parse(fs.readFileSync(releasePath, "utf8")) as ReleaseMetadata;
  } catch {
    return {};
  }
}

function docsPath(): string {
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

const latestDocsPath = docsPath();
const mintlifyDocsPath = latestDocsPath.replace(/^\/docs/u, "") || "/latest";
const redirectsToLatest = latestDocsPath === "/docs/latest";

const nextConfig: NextConfig = {
  transpilePackages: ["@tranquilo/product"],
  redirects() {
    const redirects = [
      {
        destination: latestDocsPath,
        permanent: false,
        source: "/latest",
      },
      {
        destination: `${latestDocsPath}/:path*`,
        permanent: false,
        source: "/latest/:path*",
      },
      {
        destination: "/docs/versions/:path*",
        permanent: false,
        source: "/versions/:path*",
      },
    ];
    if (!redirectsToLatest) {
      redirects.push(
        {
          destination: latestDocsPath,
          permanent: false,
          source: "/docs/latest",
        },
        {
          destination: `${latestDocsPath}/:path*`,
          permanent: false,
          source: "/docs/latest/:path*",
        }
      );
    }
    return Promise.resolve(redirects);
  },
  rewrites() {
    return Promise.resolve([
      {
        destination: `${MINTLIFY_ORIGIN}${mintlifyDocsPath}`,
        source: "/docs",
      },
      {
        destination: `${MINTLIFY_ORIGIN}/:path*`,
        source: "/docs/:path*",
      },
      {
        destination: `${MINTLIFY_ORIGIN}/mintlify-assets/:path*`,
        source: "/mintlify-assets/:path*",
      },
    ]);
  },
};

export default nextConfig;
