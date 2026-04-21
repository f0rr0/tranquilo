import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MCP_TOOLS } from "@tranquilo/cli-model/agent-catalog";
import {
  PACKAGE_METADATA,
  RELEASE_METADATA,
} from "@tranquilo/cli-model/release-metadata";
import { describe, expect, it } from "vitest";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOCAL_BUN_CHECKOUT_COMMAND_RE = /bun\s+\/Users/;
const MARKDOWN_FILE_RE = /\.(?:md|mdx)$/;

function readRepoFile(file: string): string {
  return fs.readFileSync(path.join(repoRoot, file), "utf8");
}

function readRepoTextFiles(
  dir: string
): Array<{ content: string; file: string }> {
  const root = path.join(repoRoot, dir);
  const files: Array<{ content: string; file: string }> = [];

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolutePath = path.join(root, entry.name);
    const relativePath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...readRepoTextFiles(relativePath));
      continue;
    }

    if (entry.isFile() && MARKDOWN_FILE_RE.test(entry.name)) {
      files.push({
        content: fs.readFileSync(absolutePath, "utf8"),
        file: relativePath,
      });
    }
  }

  return files;
}

function shellCommands(markdown: string): string[] {
  const commands: string[] = [];
  const blocks = markdown.matchAll(/```sh\n([\s\S]*?)```/g);
  for (const block of blocks) {
    const body = block[1];
    if (!body) {
      continue;
    }
    commands.push(
      ...body
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.startsWith("tranquilo "))
    );
  }
  return commands;
}

describe("agent-facing docs", () => {
  it("documents only safe CLI fallback commands in the Codex skill", () => {
    const skill = readRepoFile("assets/codex-skill/SKILL.md");

    expect(skill).toContain("househelp_find_slots");
    expect(skill).toContain("househelp_prepare_booking");
    expect(skill).toContain("househelp_payment_handoff");
    expect(skill).toContain("find a maid tomorrow");
    expect(skill).toContain("keep looking for 1 hour slots");
    expect(skill).toContain("after 6pm");
    expect(skill).toContain("duration 60");
    expect(skill).toContain("notify-only watch");
    expect(skill).toContain("call `auth_status` first");
    expect(skill).toContain("There is no user-facing Tranquilo app");
    expect(skill).toContain("say Pronto app");
    expect(skill).toContain("Run tranquilo login in a local terminal");
    expect(skill).toContain("Watches must not prepare checkout automatically");
    expect(skill).not.toMatch(LOCAL_BUN_CHECKOUT_COMMAND_RE);
    expect(skill).not.toContain("--open-intent");

    for (const command of shellCommands(skill)) {
      if (command.includes("--pay") || command.includes("checkout pay")) {
        expect(command).not.toContain("--open-intent");
        if (command.includes("househelp book")) {
          expect(command).toContain("--yes");
        }
        continue;
      }
      expect(command).toContain("--json");
      expect(command).toContain("--no-interactive");
    }
  });

  it("keeps Claude command docs away from human-only payment commands", () => {
    const dir = path.join(repoRoot, "assets/claude-commands/tranquilo");
    const text = fs
      .readdirSync(dir)
      .filter((file) => file.endsWith(".md"))
      .map((file) => fs.readFileSync(path.join(dir, file), "utf8"))
      .join("\n");

    expect(text).toContain("househelp_find_slots");
    expect(text).toContain("househelp_payment_handoff");
    expect(text).toContain("maid");
    expect(text).toContain("auth_status");
    expect(text).not.toContain("--open-intent");
  });

  it("advertises House Help tools in the Claude Desktop bundle manifest", () => {
    const manifest = JSON.parse(readRepoFile("mcpb/manifest.json")) as {
      compatibility: { platforms: string[] };
      dxt_version: string;
      tools: Array<{ name: string }>;
      version: string;
    };
    const tools = manifest.tools.map((tool) => tool.name);

    expect(tools).toContain("househelp_options");
    expect(tools).toContain("househelp_find_slots");
    expect(tools).toContain("househelp_prepare_booking");
    expect(tools).toContain("househelp_payment_handoff");
  });

  it("keeps generated manifest and tool schemas aligned with the catalog", () => {
    const manifest = JSON.parse(readRepoFile("mcpb/manifest.json")) as {
      compatibility: { platforms: string[] };
      dxt_version: string;
      tools: Array<{ description: string; name: string }>;
      version: string;
    };
    const schemaReference = JSON.parse(
      readRepoFile("assets/codex-skill/references/mcp-tools.json")
    ) as {
      generatedFrom: string;
      tools: Array<{
        inputSchema: { properties?: Record<string, unknown> };
        name: string;
      }>;
    };

    expect(manifest.tools.map((tool) => tool.name)).toEqual(
      MCP_TOOLS.map((tool) => tool.name)
    );
    expect(manifest.version).toBe(PACKAGE_METADATA.version);
    expect(manifest.dxt_version).toBe(RELEASE_METADATA.mcpb.dxtVersion);
    expect(manifest.compatibility.platforms).toEqual(
      RELEASE_METADATA.mcpb.compatibilityPlatforms
    );
    expect(schemaReference.generatedFrom).toBe(
      "packages/cli-model/src/agent-catalog.ts"
    );
    expect(schemaReference.tools.map((tool) => tool.name)).toEqual(
      MCP_TOOLS.map((tool) => tool.name)
    );

    for (const tool of MCP_TOOLS) {
      const manifestTool = manifest.tools.find(
        (candidate) => candidate.name === tool.name
      );
      expect(manifestTool?.description).toBe(tool.manifestDescription);
    }

    const findSchema = schemaReference.tools.find(
      (tool) => tool.name === "househelp_find_slots"
    )?.inputSchema;
    expect(findSchema?.properties?.duration).toBeDefined();
    expect(findSchema?.properties?.preset).toBeDefined();
  });

  it("keeps generated public docs grounded in current CLI/MCP surfaces", () => {
    const find = readRepoFile(
      "../../packages/docs-content/latest/househelp/find.mdx"
    );
    const book = readRepoFile(
      "../../packages/docs-content/latest/househelp/book.mdx"
    );
    const watches = readRepoFile(
      "../../packages/docs-content/latest/househelp/watches.mdx"
    );
    const manage = readRepoFile(
      "../../packages/docs-content/latest/manage/index.mdx"
    );
    const auth = readRepoFile("../../packages/docs-content/latest/auth.mdx");
    const addresses = readRepoFile(
      "../../packages/docs-content/latest/manage/addresses.mdx"
    );
    const payments = readRepoFile(
      "../../packages/docs-content/latest/manage/payments.mdx"
    );
    const bookings = readRepoFile(
      "../../packages/docs-content/latest/manage/bookings.mdx"
    );
    const mcpTools = readRepoFile(
      "../../packages/docs-content/latest/agents/mcp/tools.mdx"
    );
    const latestMeta = JSON.parse(
      readRepoFile("../../packages/docs-content/latest/meta.json")
    ) as {
      pages: string[];
      root?: boolean;
      title?: string;
    };
    const versionsMeta = JSON.parse(
      readRepoFile("../../packages/docs-content/versions/meta.json")
    ) as {
      pages: string[];
    };
    const manageMeta = JSON.parse(
      readRepoFile("../../packages/docs-content/latest/manage/meta.json")
    ) as {
      defaultOpen?: boolean;
      pages: string[];
      title?: string;
    };
    const mcpMeta = JSON.parse(
      readRepoFile("../../packages/docs-content/latest/agents/mcp/meta.json")
    ) as {
      defaultOpen?: boolean;
      pages: string[];
      title?: string;
    };
    const currentVersion = `v${PACKAGE_METADATA.version}`;

    expect(latestMeta).toMatchObject({
      root: true,
      title: "Latest",
    });
    expect(latestMeta.pages).toEqual([
      "index",
      "install",
      "auth",
      "househelp",
      "manage",
      "agents",
    ]);
    expect(versionsMeta.pages).toContain(currentVersion);
    expect(versionsMeta.pages).toContain("v0.1.0");

    expect(find).toContain("## Flags");
    expect(find).toContain("--duration-order");
    expect(find).toContain("--time-window");
    expect(find).toContain("--exact-slot");
    expect(find).toContain("--no-interactive");

    expect(book).toContain("--rank");
    expect(book).toContain("--handoff");
    expect(book).toContain("--save-qr");
    expect(book).toContain("--timeout-ms");

    expect(watches).toContain("tranquilo househelp watch scheduler install");
    expect(watches).toContain("--slack-webhook");
    expect(watches).toContain("--no-desktop-notify");
    expect(watches).toContain("--no-pay");

    expect(manage).toContain("saved addresses");
    expect(manageMeta).toMatchObject({
      defaultOpen: true,
      title: "Manage",
    });
    expect(manageMeta.pages).toEqual([
      "index",
      "addresses",
      "payments",
      "bookings",
    ]);
    expect(mcpMeta).toMatchObject({
      defaultOpen: true,
      title: "MCP",
    });
    expect(mcpMeta.pages).toEqual(["index", "tools"]);
    expect(auth).toContain("### Login flags");
    expect(auth).toContain("--no-interactive");
    expect(addresses).toContain("tranquilo addresses use");
    expect(addresses).toContain("--no-active");
    expect(payments).toContain("tranquilo checkout status");
    expect(payments).toContain("--open-intent");
    expect(bookings).toContain("--status");
    expect(bookings).toContain("--page");

    expect(mcpTools).toContain("CLI fallback");
    expect(mcpTools).toContain("househelp_find_slots");
    expect(mcpTools).toContain(
      "tranquilo househelp find --duration 60 --preset next-4-days --window smart --json --no-interactive"
    );
  });

  it("renders angle-bracket placeholders as code, not HTML entities", () => {
    const generatedDocs = [
      ...readRepoTextFiles("../../packages/docs-content/latest"),
      ...readRepoTextFiles("../../packages/docs-content/versions"),
      {
        content: readRepoFile("../../packages/docs-content/skill.md"),
        file: "../../packages/docs-content/skill.md",
      },
      {
        content: readRepoFile("assets/codex-skill/SKILL.md"),
        file: "assets/codex-skill/SKILL.md",
      },
    ];

    for (const doc of generatedDocs) {
      if (doc.content.includes("&lt;") || doc.content.includes("&gt;")) {
        throw new Error(`HTML angle entities found in ${doc.file}`);
      }
    }

    expect(
      readRepoFile("../../packages/docs-content/latest/manage/addresses.mdx")
    ).toContain("`tranquilo addresses use <address-id>`");
    expect(
      readRepoFile("../../packages/docs-content/latest/agents/mcp/tools.mdx")
    ).toContain(
      "`tranquilo househelp payment-handoff <orderId> --json --no-interactive`"
    );
    expect(readRepoFile("../../packages/docs-content/skill.md")).toContain(
      "`book watch <id>`"
    );
    expect(
      readRepoFile("../../packages/docs-content/versions/v0.1.0/install.mdx")
    ).toContain("https://tranquilo-ai.vercel.app/releases/v0.1.0/install.sh");
    expect(
      readRepoFile("../../packages/docs-content/versions/v0.1.1/install.mdx")
    ).not.toContain("/releases/v0.1.1/releases/v0.1.1");
  });

  it("keeps the maintainer skill aligned with release and agent-doc rules", () => {
    const skill = readRepoFile("assets/maintainer-skill/SKILL.md");

    expect(skill).toContain("Changesets");
    expect(skill).toContain("conventional commit");
    expect(skill).toContain("pre-push");
    expect(skill).toContain("CHANGELOG.md");
    expect(skill).toContain("bun run actions:lint");
    expect(skill).toContain("bun run generate");
    expect(skill).toContain("bun run knip:check");
    expect(skill).toContain("bun run release:verify");
    expect(skill).toContain("packages/cli-model/src/agent-catalog.ts");
    expect(skill).toContain("bun run generate");
    expect(skill).toContain("@anthropic-ai/mcpb");
    expect(skill).toContain("does not solve drift");
    expect(skill).toContain("MCP");
    expect(skill).toContain("Never hand-edit generated release sections");
  });
});
