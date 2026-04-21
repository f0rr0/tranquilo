import { AGENT_CATALOG } from "@tranquilo/product/agent-catalog";
import { describe, expect, it } from "vitest";
import { createMcpServer } from "../src/mcp";

const {
  agentSafeCliCommands,
  agentSafeMcpTools,
  humanOnlyCliCommands,
  localAgentCliCommands,
} = AGENT_CATALOG;

describe("MCP server", () => {
  it("registers tools and prompts that mirror the supported CLI surface", () => {
    const server = createMcpServer() as unknown as {
      _registeredTools: Record<
        string,
        { annotations?: Record<string, unknown>; description?: string }
      >;
      _registeredPrompts: Record<string, { description?: string }>;
    };
    const tool = (name: string) => {
      const registered = server._registeredTools[name];
      if (!registered) {
        throw new Error(`Expected MCP tool ${name} to be registered.`);
      }
      return registered;
    };
    const prompt = (name: string) => {
      const registered = server._registeredPrompts[name];
      if (!registered) {
        throw new Error(`Expected MCP prompt ${name} to be registered.`);
      }
      return registered;
    };

    expect(Object.keys(server._registeredTools).sort()).toEqual([
      "address_show",
      "address_use",
      "addresses_list",
      "auth_status",
      "bookings_list",
      "househelp_find_slots",
      "househelp_options",
      "househelp_payment_handoff",
      "househelp_prepare_booking",
      "househelp_watch_create",
      "househelp_watch_delete",
      "househelp_watch_list",
      "househelp_watch_pause",
      "househelp_watch_resume",
      "househelp_watch_run_now",
      "househelp_watch_show",
    ]);
    expect(Object.keys(server._registeredPrompts).sort()).toEqual([
      "find_househelp_slots",
      "list_bookings",
      "prepare_slot_payment",
      "show_slot_watches",
      "watch_after_work_slots",
    ]);
    for (const tool of agentSafeMcpTools) {
      expect(server._registeredTools[tool]).toBeDefined();
    }
    expect(tool("househelp_options").annotations?.readOnlyHint).toBe(true);
    expect(tool("auth_status").description).toContain("First tool");
    expect(tool("auth_status").description).toContain("maid");
    expect(tool("househelp_find_slots").description).toContain(
      "find a maid tomorrow"
    );
    expect(tool("househelp_find_slots").description).toContain(
      "Fallback durations"
    );
    expect(prompt("find_househelp_slots").description).toContain("maid");
    expect(JSON.stringify(prompt("find_househelp_slots"))).toContain(
      "Pronto is the app"
    );
    expect(JSON.stringify(prompt("find_househelp_slots"))).toContain(
      "keep looking for 1 hour slots"
    );
    expect(JSON.stringify(prompt("find_househelp_slots"))).toContain(
      "notify-only"
    );
    expect(tool("househelp_find_slots").annotations?.readOnlyHint).toBe(true);
    expect(tool("househelp_prepare_booking").annotations?.readOnlyHint).toBe(
      false
    );
    expect(tool("househelp_watch_delete").annotations?.destructiveHint).toBe(
      true
    );
    expect(tool("address_use").annotations?.readOnlyHint).toBe(false);
    expect(
      Object.entries(server._registeredTools)
        .filter(([, tool]) => tool.annotations?.readOnlyHint === false)
        .map(([name]) => name)
        .sort()
    ).toEqual([
      "address_use",
      "househelp_prepare_booking",
      "househelp_watch_create",
      "househelp_watch_delete",
      "househelp_watch_pause",
      "househelp_watch_resume",
      "househelp_watch_run_now",
    ]);
  });

  it("declares an explicit agent-safe CLI contract", () => {
    expect(agentSafeCliCommands.length).toBeGreaterThan(0);
    for (const command of agentSafeCliCommands) {
      expect(command.agentSafe).toBe(true);
      expect(command.command).toContain("--json");
      expect(command.command).toContain("--no-interactive");
      expect(command.requiresJson).toBe(true);
      expect(command.requiresNoInteractive).toBe(true);
    }
    expect(humanOnlyCliCommands.map((command) => command.command)).toContain(
      "tranquilo checkout pay --open-intent"
    );
    expect(localAgentCliCommands.map((command) => command.command)).toEqual([
      "tranquilo househelp book --pay --yes",
      "tranquilo checkout pay",
    ]);
    for (const command of localAgentCliCommands) {
      expect(command.requiresLocalTerminal).toBe(true);
      expect(command.requiresUserApproval).toBe(true);
      expect(command.printsQr).toBe(true);
      expect(command.pollsPayment).toBe(true);
    }
  });
});
