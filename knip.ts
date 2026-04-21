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
    "packages/docs-content": {
      entry: [],
      project: [],
    },
    "apps/site": {
      entry: [
        "app/**/page.tsx!",
        "app/**/layout.tsx!",
        "app/**/route.ts!",
        "source.config.ts!",
      ],
      project: ["app/**/*.{ts,tsx}", "components/**/*.tsx", "lib/**/*.ts"],
    },
    "packages/cli-model": {
      entry: ["src/*.ts!"],
      project: ["src/**/*.ts"],
    },
    "packages/site-model": {
      entry: ["src/*.ts!", "tests/**/*.test.ts"],
      project: ["src/**/*.ts", "tests/**/*.ts"],
    },
  },
  ignoreDependencies: [
    // Ultracite shells out to the Biome binary but does not list it as a dependency.
    "@biomejs/biome",
    // Tailwind is consumed from CSS through @import "tailwindcss".
    "tailwindcss",
    // Vercel detects the Next.js framework from the repo root package.
    "next",
  ],
  ignoreIssues: {
    // Fumadocs generates the virtual `collections` module during typegen/build.
    "apps/site/lib/source.ts": ["unlisted"],
    // Next.js discovers these files by framework convention.
    "apps/site/app/layout.tsx": ["exports"],
    "apps/site/app/docs/layout.tsx": ["exports"],
    "apps/site/next.config.ts": ["exports"],
    "apps/site/source.config.ts": ["exports"],
  },
  ignoreBinaries: [
    "gh",
    "launchctl",
    "notify-send",
    "osascript",
    "schtasks.exe",
    "systemctl",
    "tar",
  ],
};

export default config;
