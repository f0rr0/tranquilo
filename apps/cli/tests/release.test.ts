import {
  handleInstallRoute,
  renderInstallSh,
} from "@tranquilo/product/install-routes";
import {
  PACKAGE_METADATA,
  RELEASE_METADATA,
} from "@tranquilo/product/release-metadata";
import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  hasChangeset,
  needsChangeset,
  shouldRequireChangeset,
} from "../../../scripts/check-changeset";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function zippedArtifactResponse(
  name: string,
  content: Uint8Array | string
): Response {
  const data =
    typeof content === "string" ? new TextEncoder().encode(content) : content;
  return new Response(zipSync({ [name]: data }), {
    headers: { "content-type": "application/zip" },
  });
}

describe("release packaging helpers", () => {
  it("selects macOS-only targets for PR previews", () => {
    expect(
      RELEASE_METADATA.prTargets.map(RELEASE_METADATA.archiveName)
    ).toEqual(["tranquilo-darwin-arm64.tar.gz", "tranquilo-darwin-x64.tar.gz"]);
    expect(RELEASE_METADATA.targetsForMode("pr")).toEqual(
      RELEASE_METADATA.prTargets
    );
  });

  it("selects the full platform matrix for main releases", () => {
    expect(
      RELEASE_METADATA.releaseTargets.map(RELEASE_METADATA.archiveName)
    ).toEqual([
      "tranquilo-darwin-arm64.tar.gz",
      "tranquilo-darwin-x64.tar.gz",
      "tranquilo-linux-arm64.tar.gz",
      "tranquilo-linux-x64.tar.gz",
      "tranquilo-win32-arm64.zip",
      "tranquilo-win32-x64.zip",
    ]);
  });

  it("grounds release metadata in package.json", async () => {
    const packageJson = await import("../package.json", {
      with: { type: "json" },
    });
    const metadata = packageJson.default.tranquilo;

    expect(PACKAGE_METADATA.version).toBe(packageJson.default.version);
    expect(RELEASE_METADATA.prTargets).toEqual(metadata.release.prTargets);
    expect(RELEASE_METADATA.releaseTargets).toEqual(metadata.release.targets);
    expect(RELEASE_METADATA.mcpb).toEqual({
      compatibilityPlatforms: metadata.mcpb.compatibilityPlatforms,
      dxtVersion: metadata.mcpb.dxtVersion,
    });
  });
});

describe("changeset gate helpers", () => {
  it("requires changesets for release-affecting files", () => {
    expect(needsChangeset(["apps/cli/src/cli.ts"])).toBe(true);
    expect(needsChangeset(["apps/cli/scripts/package-release.ts"])).toBe(true);
    expect(needsChangeset(["packages/product/src/agent-catalog.ts"])).toBe(
      true
    );
    expect(needsChangeset(["packages/product/src/release-metadata.ts"])).toBe(
      true
    );
    expect(needsChangeset(["apps/landing/app/install.sh/route.ts"])).toBe(
      false
    );
    expect(needsChangeset(["apps/docs/docs.json"])).toBe(false);
    expect(needsChangeset(["scripts/generate-product-assets.ts"])).toBe(false);
    expect(needsChangeset(["README.md", "apps/cli/tests/api.test.ts"])).toBe(
      false
    );
    expect(hasChangeset([".changeset/release-automation.md"])).toBe(true);
  });

  it("does not require changesets before the first release tag", () => {
    expect(shouldRequireChangeset(["apps/cli/src/cli.ts"], false)).toBe(false);
    expect(shouldRequireChangeset(["apps/cli/src/cli.ts"], true)).toBe(true);
    expect(
      shouldRequireChangeset(
        ["apps/cli/src/cli.ts", ".changeset/internal.md"],
        true
      )
    ).toBe(false);
  });
});

describe("install routes", () => {
  const env = {
    GITHUB_OWNER: "withpronto",
    GITHUB_REPO: "tranquilo",
    GITHUB_TOKEN: "token",
    PUBLIC_INSTALL_BASE_URL: "https://tranquilo-ai.vercel.app",
  };

  it("renders stable and PR install scripts", async () => {
    const stable = await handleInstallRoute({ path: "install.sh" }, env);
    expect(stable.body).toContain(
      'DEFAULT_BASE_URL="https://tranquilo-ai.vercel.app/releases/latest"'
    );
    expect(stable.body).toContain(`PR_MAC_ONLY="\${TRANQUILO_PR_MAC_ONLY:-0}"`);

    const preview = await handleInstallRoute({ path: "pr/12/install.sh" }, env);
    expect(preview.body).toContain(
      'DEFAULT_BASE_URL="https://tranquilo-ai.vercel.app/pr/12/latest"'
    );
    expect(preview.body).toContain(
      `PR_MAC_ONLY="\${TRANQUILO_PR_MAC_ONLY:-1}"`
    );
  });

  it("uses request origin and Vercel repo metadata without explicit base or repo env", async () => {
    const stable = await handleInstallRoute(
      { origin: "https://preview.tranquilo.test", path: "install.sh" },
      {
        GITHUB_TOKEN: "token",
        VERCEL_GIT_REPO_OWNER: "f0rr0",
        VERCEL_GIT_REPO_SLUG: "tranquilo",
      }
    );
    expect(stable.body).toContain(
      'DEFAULT_BASE_URL="https://preview.tranquilo.test/releases/latest"'
    );

    const result = await handleInstallRoute(
      { path: "releases/latest/tranquilo-darwin-arm64.tar.gz" },
      {
        GITHUB_TOKEN: "token",
        VERCEL_GIT_REPO_OWNER: "f0rr0",
        VERCEL_GIT_REPO_SLUG: "tranquilo",
        fetch: (input) => {
          expect(String(input)).toContain("/repos/f0rr0/tranquilo/");
          return Promise.resolve(
            jsonResponse({
              assets: [
                {
                  browser_download_url: "https://github.test/release.tgz",
                  name: "tranquilo-darwin-arm64.tar.gz",
                },
              ],
            })
          );
        },
      }
    );
    expect(result.status).toBe(302);
  });

  it("rejects non-macOS PR artifacts", async () => {
    const result = await handleInstallRoute(
      { path: "pr/12/latest/tranquilo-linux-x64.tar.gz" },
      env
    );
    expect(result.status).toBe(400);
    expect(result.body).toContain("macOS");
  });

  it("redirects release assets to GitHub release downloads", async () => {
    const result = await handleInstallRoute(
      { path: "releases/latest/tranquilo-darwin-arm64.tar.gz" },
      {
        ...env,
        fetch: () =>
          Promise.resolve(
            jsonResponse({
              assets: [
                {
                  browser_download_url: "https://github.test/release.tgz",
                  name: "tranquilo-darwin-arm64.tar.gz",
                },
              ],
            })
          ),
      }
    );

    expect(result).toMatchObject({
      headers: { location: "https://github.test/release.tgz" },
      status: 302,
    });
  });

  it("reads public release assets without explicit GitHub env", async () => {
    const result = await handleInstallRoute(
      { path: "releases/latest/tranquilo-darwin-arm64.tar.gz" },
      {
        fetch: (input, init) => {
          expect(String(input)).toContain("/repos/f0rr0/tranquilo/");
          expect(init?.headers).not.toHaveProperty("authorization");
          return Promise.resolve(
            jsonResponse({
              assets: [
                {
                  browser_download_url: "https://github.test/public.tgz",
                  name: "tranquilo-darwin-arm64.tar.gz",
                },
              ],
            })
          );
        },
      }
    );

    expect(result).toMatchObject({
      headers: { location: "https://github.test/public.tgz" },
      status: 302,
    });
  });

  it("serves latest PR assets from GitHub artifact zips", async () => {
    const calls: string[] = [];
    const artifactBody = new TextEncoder().encode("darwin-arm64-preview");
    const result = await handleInstallRoute(
      { path: "pr/12/latest/tranquilo-darwin-arm64.tar.gz" },
      {
        ...env,
        fetch: (input) => {
          calls.push(String(input));
          if (String(input).includes("/actions/artifacts?")) {
            return Promise.resolve(
              jsonResponse({
                artifacts: [
                  {
                    archive_download_url:
                      "https://api.github.test/artifacts/1/zip",
                    created_at: "2026-04-20T00:00:00Z",
                    expired: false,
                    name: "tranquilo-pr-12-abc-tranquilo-darwin-arm64.tar.gz",
                  },
                ],
              })
            );
          }
          return Promise.resolve(
            zippedArtifactResponse(
              "tranquilo-pr-12-abc-tranquilo-darwin-arm64.tar.gz",
              artifactBody
            )
          );
        },
      }
    );

    expect(calls).toHaveLength(2);
    expect(result.status).toBe(200);
    expect(result.headers["content-type"]).toBe("application/gzip");
    expect(result.body).toEqual(artifactBody);
  });

  it("serves exact PR SHA assets", async () => {
    const checksumBody = "abc123  tranquilo-darwin-x64.tar.gz\n";
    const result = await handleInstallRoute(
      { path: "pr/12/def/checksums.txt" },
      {
        ...env,
        fetch: (input) => {
          if (String(input).includes("/actions/artifacts?")) {
            return Promise.resolve(
              jsonResponse({
                artifacts: [
                  {
                    archive_download_url:
                      "https://api.github.test/artifacts/2/zip",
                    created_at: "2026-04-20T00:00:00Z",
                    expired: false,
                    name: "tranquilo-pr-12-def-checksums.txt",
                  },
                ],
              })
            );
          }
          return Promise.resolve(
            zippedArtifactResponse(
              "tranquilo-pr-12-def-checksums.txt",
              checksumBody
            )
          );
        },
      }
    );

    expect(result.status).toBe(200);
    expect(result.headers["content-type"]).toBe("text/plain; charset=utf-8");
    expect(new TextDecoder().decode(result.body as Uint8Array)).toBe(
      checksumBody
    );
  });

  it("returns clear errors for missing PR token or artifacts", async () => {
    const missingToken = await handleInstallRoute({
      path: "pr/12/latest/tranquilo-darwin-arm64.tar.gz",
    });
    expect(missingToken.status).toBe(502);
    expect(missingToken.body).toContain("Missing GITHUB_TOKEN");

    const missingArtifact = await handleInstallRoute(
      { path: "pr/12/latest/tranquilo-darwin-arm64.tar.gz" },
      { ...env, fetch: async () => jsonResponse({ artifacts: [] }) }
    );
    expect(missingArtifact.status).toBe(404);
  });

  it("keeps generated shell installers checksum-strict", () => {
    const script = renderInstallSh({
      baseUrl: "https://tranquilo-ai.vercel.app/releases/latest",
    });
    expect(script).toContain("Checksum entry missing");
    expect(script).toContain("Checksum mismatch");
    expect(script).toContain("command -v sha256sum");
  });

  it("uses the bash installer for Windows", async () => {
    const script = renderInstallSh({
      baseUrl: "https://tranquilo-ai.vercel.app/releases/latest",
    });
    expect(script).toContain("MINGW*|MSYS*|CYGWIN*");
    expect(script).toContain(`archive="tranquilo-win32-\${arch}.zip"`);
    expect(script).toContain('binary="tranquilo.exe"');
    expect(script).toContain("unzip -q");
    expect(script.toLowerCase()).not.toContain(`power${"shell"}`);

    const ps1 = await handleInstallRoute({ path: `install.p${"s1"}` }, env);
    expect(ps1.status).toBe(404);
  });

  it("does not advertise alternate Windows installers on the landing page", async () => {
    const page = await handleInstallRoute({ path: "" }, env);
    if (typeof page.body !== "string") {
      throw new TypeError("Expected landing page response to be text.");
    }
    expect(page.body).toContain("install.sh");
    expect(page.body).not.toContain(`install.p${"s1"}`);
    expect(page.body.toLowerCase()).not.toContain(`power${"shell"}`);
  });

  it("configures agent integrations from the one-line installer", () => {
    const script = renderInstallSh({
      baseUrl: "https://tranquilo-ai.vercel.app/releases/latest",
    });
    expect(script).toContain(
      `AGENT_TARGET="\${TRANQUILO_INSTALL_AGENT_TARGET:-auto}"`
    );
    expect(script).toContain("TRANQUILO_PACKAGE_ROOT");
    expect(script).toContain("TRANQUILO_MCP_COMMAND");
    expect(script).toContain('install-agent "$AGENT_TARGET"');
    expect(script).toContain("TRANQUILO_SKIP_AGENT_INSTALL");
  });
});
