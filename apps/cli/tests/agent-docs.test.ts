import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MCP_TOOLS } from "@tranquilo/product/agent-catalog";
import {
  PACKAGE_METADATA,
  RELEASE_METADATA,
} from "@tranquilo/product/release-metadata";
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
    expect(skill).not.toContain('onFound="checkout"');
    expect(skill).toContain("call `auth_status` first");
    expect(skill).toContain("There is no user-facing Tranquilo app");
    expect(skill).toContain("say Pronto app");
    expect(skill).toContain("Run tranquilo login in a local terminal");
    expect(skill).not.toMatch(LOCAL_BUN_CHECKOUT_COMMAND_RE);
    expect(skill).not.toContain("tranquilo checkout start");
    expect(skill).not.toContain("tranquilo slots book");
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
    expect(tools).not.toContain("checkout_start");
    expect(tools).not.toContain("checkout_payment_instructions");
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
      "packages/product/src/agent-catalog.ts"
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
    const find = readRepoFile("../docs/latest/househelp/find.mdx");
    const book = readRepoFile("../docs/latest/househelp/book.mdx");
    const watches = readRepoFile("../docs/latest/househelp/watches.mdx");
    const manage = readRepoFile("../docs/latest/manage.mdx");
    const auth = readRepoFile("../docs/latest/auth.mdx");
    const addresses = readRepoFile("../docs/latest/addresses.mdx");
    const payments = readRepoFile("../docs/latest/payments.mdx");
    const bookings = readRepoFile("../docs/latest/bookings.mdx");
    const mcpTools = readRepoFile("../docs/latest/reference/mcp-tools.mdx");
    const docsConfig = JSON.parse(readRepoFile("../docs/docs.json")) as {
      navigation: {
        versions: Array<{
          groups: Array<{
            directory?: string;
            group: string;
            pages: unknown[];
            root?: string;
          }>;
        }>;
      };
    };
    const manageGroup = docsConfig.navigation.versions[0]?.groups.find(
      (group) => group.group === "Manage"
    );

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
    expect(manageGroup).toMatchObject({
      directory: "accordion",
      root: "latest/manage",
    });
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
      ...readRepoTextFiles("../docs/latest"),
      {
        content: readRepoFile("../docs/skill.md"),
        file: "../docs/skill.md",
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

    expect(readRepoFile("../docs/latest/addresses.mdx")).toContain(
      "`tranquilo addresses use <address-id>`"
    );
    expect(readRepoFile("../docs/latest/reference/mcp-tools.mdx")).toContain(
      "`tranquilo househelp payment-handoff <orderId> --json --no-interactive`"
    );
    expect(readRepoFile("../docs/skill.md")).toContain("`book watch <id>`");
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
    expect(skill).toContain("packages/product/src/agent-catalog.ts");
    expect(skill).toContain("bun run generate");
    expect(skill).toContain("@anthropic-ai/mcpb");
    expect(skill).toContain("does not solve drift");
    expect(skill).toContain("MCP");
    expect(skill).toContain("Never hand-edit generated release sections");
  });
});
