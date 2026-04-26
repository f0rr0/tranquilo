import { describe, expect, it } from "vitest";
import release from "../generated/release.json";
import { latestDocsPath, resolveLatestDocsPath } from "./release";

describe("resolveLatestDocsPath", () => {
  it("uses bundled release metadata for the stable docs redirect", () => {
    expect(latestDocsPath()).toBe(`/docs/versions/v${release.version}`);
  });

  it("uses versioned docs as fallback when docsUrl is missing", () => {
    expect(resolveLatestDocsPath({ version: "0.1.5" })).toBe(
      "/docs/versions/v0.1.5"
    );
  });

  it("avoids self-redirect loops when docsUrl points to /docs", () => {
    expect(
      resolveLatestDocsPath({
        docsUrl: "https://tranquilo-ai.vercel.app/docs",
        version: "0.1.5",
      })
    ).toBe("/docs/versions/v0.1.5");
  });

  it("avoids self-redirect loops when docsUrl has a trailing slash", () => {
    expect(
      resolveLatestDocsPath({
        docsUrl: "https://tranquilo-ai.vercel.app/docs/",
        version: "0.1.5",
      })
    ).toBe("/docs/versions/v0.1.5");
  });

  it("avoids self-redirect loops when docsUrl points to /docs/latest", () => {
    expect(
      resolveLatestDocsPath({
        docsUrl: "https://tranquilo-ai.vercel.app/docs/latest",
        version: "0.1.5",
      })
    ).toBe("/docs/versions/v0.1.5");
  });

  it("keeps explicit versioned docs paths", () => {
    expect(
      resolveLatestDocsPath({
        docsUrl: "https://tranquilo-ai.vercel.app/docs/versions/v0.1.5",
        version: "0.1.5",
      })
    ).toBe("/docs/versions/v0.1.5");
  });

  it("supports relative docs URLs", () => {
    expect(
      resolveLatestDocsPath({
        docsUrl: "/docs/versions/v0.1.5/install",
        version: "0.1.5",
      })
    ).toBe("/docs/versions/v0.1.5/install");
  });

  it("falls back to versioned docs when docsUrl is invalid", () => {
    expect(
      resolveLatestDocsPath({
        docsUrl: "https://",
        version: "0.1.5",
      })
    ).toBe("/docs/versions/v0.1.5");
  });
});
