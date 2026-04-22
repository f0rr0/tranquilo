import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AGENT_CATALOG } from "@tranquilo/cli-model/agent-catalog";
import { describe, expect, it, vi } from "vitest";
import { createMcpServer } from "../src/mcp";
import { clearCredentials, loadCredentials } from "../src/storage";

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
      "auth_login_start",
      "auth_login_verify",
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
    expect(tool("auth_login_start").description).toContain("phone number");
    expect(tool("auth_login_verify").description).toContain(
      "OTP is allowed only for this login tool"
    );
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
    expect(tool("auth_login_start").annotations?.readOnlyHint).toBe(false);
    expect(tool("auth_login_verify").annotations?.readOnlyHint).toBe(false);
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
      "auth_login_start",
      "auth_login_verify",
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
      "tranquilo househelp book --pay --yes --upi-app <phonepe|googlepay|paytm>",
      "tranquilo checkout pay --upi-app <phonepe|googlepay|paytm>",
    ]);
    for (const command of localAgentCliCommands) {
      expect(command.requiresLocalTerminal).toBe(true);
      expect(command.requiresUserApproval).toBe(true);
      expect(command.printsQr).toBe(true);
      expect(command.pollsPayment).toBe(true);
    }
  });

  it("supports two-step agent OTP login and stores credentials locally", async () => {
    const originalEnv = { ...process.env };
    const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "tranquilo-mcp-"));
    process.env.TRANQUILO_CONFIG_DIR = tempDir;
    process.env.TRANQUILO_STATE_DIR = tempDir;
    process.env.TRANQUILO_BASE_URL = "https://mock.pronto.test";
    delete process.env.TRANQUILO_TOKEN;
    delete process.env.TRANQUILO_REFRESH_TOKEN;
    await clearCredentials();

    vi.stubGlobal(
      "fetch",
      vi.fn((url: string | URL, init?: RequestInit) => {
        const requestUrl = new URL(String(url));
        const body =
          typeof init?.body === "string" ? JSON.parse(init.body) : {};
        if (requestUrl.pathname === "/gateway/auth/login") {
          return new Response(
            JSON.stringify({
              data: { token: `otp-token-${body.mobileNumber}` },
            }),
            { headers: { "content-type": "application/json" }, status: 200 }
          );
        }
        if (requestUrl.pathname === "/gateway/auth/verify") {
          return new Response(
            JSON.stringify({
              data: {
                data: {
                  refreshToken: "refresh-token",
                  token: "access-token",
                  userData: { id: "user-1" },
                },
              },
              status: "OK",
            }),
            { headers: { "content-type": "application/json" }, status: 200 }
          );
        }
        return new Response(JSON.stringify({ status: "NOT_FOUND" }), {
          status: 404,
        });
      })
    );

    try {
      const server = createMcpServer() as unknown as {
        _registeredTools: Record<
          string,
          { handler: (args: Record<string, unknown>) => Promise<unknown> }
        >;
      };
      const startTool = server._registeredTools.auth_login_start;
      const verifyTool = server._registeredTools.auth_login_verify;
      if (!(startTool && verifyTool)) {
        throw new Error("Expected MCP login tools to be registered.");
      }
      const start = (await startTool.handler({
        mobileNumber: "+919999999999",
      })) as { structuredContent?: Record<string, unknown> };
      expect(start.structuredContent).toMatchObject({
        mobileNumber: "+919999999999",
      });
      expect(start.structuredContent?.loginSessionId).toEqual(
        expect.any(String)
      );

      const verify = (await verifyTool.handler({
        loginSessionId: start.structuredContent?.loginSessionId,
        otp: "123456",
      })) as { structuredContent?: Record<string, unknown> };

      expect(verify.structuredContent).toMatchObject({
        authenticated: true,
        mobileNumber: "+919999999999",
        storage: "encrypted-file",
        userId: "user-1",
      });
      await expect(loadCredentials()).resolves.toMatchObject({
        accessToken: "access-token",
        mobileNumber: "+919999999999",
        refreshToken: "refresh-token",
        userId: "user-1",
      });
    } finally {
      vi.unstubAllGlobals();
      process.env = originalEnv;
      await fsp.rm(tempDir, { force: true, recursive: true });
    }
  });
});
