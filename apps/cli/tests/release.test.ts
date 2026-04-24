import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PACKAGE_METADATA,
  RELEASE_METADATA,
} from "@tranquilo/cli-model/release-metadata";
import { describe, expect, it } from "vitest";
import {
  affectedPackageNames,
  changesetPackageNames,
  hasChangeset,
  invalidChangesetPackages,
  isTranquiloAffected,
  shouldRequireChangeset,
} from "../../../scripts/check-changeset";
import { metaJson } from "../../../scripts/generate-product-assets";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.."
);
const BUN_PACKAGE_MANAGER_RE = /^bun@/u;
const SEMVER_RE = /^\d+\.\d+\.\d+$/u;

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

  it("keeps Vercel configured for repo-root deployment", async () => {
    const rootConfig = JSON.parse(
      await fs.readFile(path.join(REPO_ROOT, "vercel.json"), "utf8")
    ) as Record<string, unknown>;
    const packageJson = JSON.parse(
      await fs.readFile(path.join(REPO_ROOT, "package.json"), "utf8")
    ) as { devDependencies?: Record<string, string>; packageManager?: string };
    const bunVersion = packageJson.packageManager?.replace(
      BUN_PACKAGE_MANAGER_RE,
      ""
    );

    expect(bunVersion).toMatch(SEMVER_RE);
    expect(rootConfig).toMatchObject({
      buildCommand: `bunx bun@${bunVersion} turbo run build --filter=@tranquilo/site`,
      framework: "nextjs",
      installCommand: `bunx bun@${bunVersion} install --frozen-lockfile`,
      outputDirectory: "apps/site/.next",
    });
    expect(packageJson.devDependencies?.next).toBe("catalog:web");
    await expect(
      fs.access(path.join(REPO_ROOT, "apps/site/vercel.json"))
    ).rejects.toThrow();
  });

  it("keeps Changesets scoped to CLI releases", async () => {
    const config = JSON.parse(
      await fs.readFile(path.join(REPO_ROOT, ".changeset/config.json"), "utf8")
    ) as {
      ignore?: string[];
      privatePackages?: { tag?: boolean; version?: boolean };
    };
    const releaseWorkflow = await fs.readFile(
      path.join(REPO_ROOT, ".github/workflows/release.yml"),
      "utf8"
    );
    const cliPackage = JSON.parse(
      await fs.readFile(path.join(REPO_ROOT, "apps/cli/package.json"), "utf8")
    ) as { dependencies?: Record<string, string> };
    const sitePackage = JSON.parse(
      await fs.readFile(path.join(REPO_ROOT, "apps/site/package.json"), "utf8")
    ) as { dependencies?: Record<string, string> };

    expect(config.ignore).toEqual([
      "@tranquilo/docs-content",
      "@tranquilo/site",
      "@tranquilo/site-model",
    ]);
    expect(config.privatePackages).toEqual({ tag: false, version: true });
    expect(cliPackage.dependencies).toHaveProperty("@tranquilo/cli-model");
    expect(cliPackage.dependencies).not.toHaveProperty("@tranquilo/site-model");
    expect(sitePackage.dependencies).not.toHaveProperty("@tranquilo/cli-model");
    expect(sitePackage.dependencies).toHaveProperty("@tranquilo/site-model");
    expect(releaseWorkflow).toContain("Validate release intent");
    expect(releaseWorkflow).toContain("previous_version=");
    expect(releaseWorkflow).toContain("force_current_version");
    expect(releaseWorkflow).toContain("cleanup_only=true");
    expect(releaseWorkflow).toContain("Commit no-release changeset cleanup");
  });

  it("formats generated docs metadata within the formatter line width", () => {
    expect(
      metaJson({
        title: "Tranquilo Docs",
        pages: ["versions"],
      })
    ).toBe(`{
  "title": "Tranquilo Docs",
  "pages": ["versions"]
}
`);

    expect(
      metaJson({
        title: "Versions",
        pages: [
          "v0.1.6",
          "v0.1.5",
          "v0.1.4",
          "v0.1.3",
          "v0.1.2",
          "v0.1.1",
          "v0.1.0",
        ],
      })
    ).toBe(`{
  "title": "Versions",
  "pages": [
    "v0.1.6",
    "v0.1.5",
    "v0.1.4",
    "v0.1.3",
    "v0.1.2",
    "v0.1.1",
    "v0.1.0"
  ]
}
`);
  });
});

describe("changeset gate helpers", () => {
  it("parses Turbo affected package output", () => {
    expect(
      affectedPackageNames(`• turbo 2.9.6
{
  "data": {
    "affectedPackages": {
      "items": [
        { "name": "@tranquilo/site" },
        { "name": "tranquilo" }
      ]
    }
  }
}`)
    ).toEqual(["@tranquilo/site", "tranquilo"]);
  });

  it("treats Changesets as explicit release intent", () => {
    expect(hasChangeset([".changeset/release-automation.md"])).toBe(true);
    expect(hasChangeset([".changeset/config.json", "README.md"])).toBe(false);
    expect(
      changesetPackageNames(`---
"tranquilo": patch
---

Release note.
`)
    ).toEqual(["tranquilo"]);
    expect(
      changesetPackageNames(`---
---

No CLI release.
`)
    ).toEqual([]);
    expect(
      invalidChangesetPackages([
        {
          content: `---
"@tranquilo/cli-model": patch
---
`,
          path: ".changeset/private-package.md",
        },
      ])
    ).toEqual([".changeset/private-package.md: @tranquilo/cli-model"]);
  });

  it("requires intent only when Turbo says the CLI workspace is affected", () => {
    expect(isTranquiloAffected(["@tranquilo/site"])).toBe(false);
    expect(isTranquiloAffected(["@tranquilo/site", "tranquilo"])).toBe(true);
    expect(
      shouldRequireChangeset(["@tranquilo/site"], ["apps/site/app/page.tsx"])
    ).toBe(false);
    expect(shouldRequireChangeset(["tranquilo"], ["apps/cli/src/cli.ts"])).toBe(
      true
    );
    expect(
      shouldRequireChangeset(
        ["tranquilo"],
        ["apps/cli/src/cli.ts", ".changeset/internal.md"]
      )
    ).toBe(false);
  });
});
