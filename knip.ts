import type { KnipConfig } from "knip";

const config: KnipConfig = {
  includeEntryExports: true,
  treatConfigHintsAsErrors: true,
  workspaces: {
    ".": {
      project: ["scripts/**/*.ts", "*.config.{ts,cjs}"],
    },
    "apps/cli": {
      entry: ["tests/**/*.test.ts"],
      project: [
        "scripts/**/*.ts",
        "src/**/*.ts",
        "tests/**/*.ts",
        "*.config.ts",
      ],
    },
    "apps/docs": {
      entry: [],
      project: [],
    },
    "apps/landing": {
      entry: ["app/**/page.tsx!", "app/**/route.ts!"],
      project: ["app/**/*.{ts,tsx}"],
    },
    "packages/product": {
      entry: ["src/*.ts!"],
      project: ["src/**/*.ts"],
    },
  },
  ignoreDependencies: [
    // Ultracite shells out to the Biome binary but does not list it as a dependency.
    "@biomejs/biome",
  ],
  ignoreIssues: {
    // Next.js discovers these files by framework convention.
    "apps/landing/app/layout.tsx": ["exports"],
    "apps/landing/next.config.ts": ["exports"],
  },
  ignoreBinaries: [
    "gh",
    "launchctl",
    "mint",
    "notify-send",
    "osascript",
    "schtasks.exe",
    "systemctl",
    "tar",
  ],
};

export default config;
