import type { NextConfig } from "next";

const MINTLIFY_ORIGIN = "https://personal-0b466684.mintlify.app";

const nextConfig: NextConfig = {
  transpilePackages: ["@tranquilo/product"],
  redirects() {
    return Promise.resolve([
      {
        destination: "/docs/latest",
        permanent: false,
        source: "/latest",
      },
      {
        destination: "/docs/latest/:path*",
        permanent: false,
        source: "/latest/:path*",
      },
      {
        destination: "/docs/versions/:path*",
        permanent: false,
        source: "/versions/:path*",
      },
    ]);
  },
  rewrites() {
    return Promise.resolve([
      {
        destination: `${MINTLIFY_ORIGIN}/latest`,
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
