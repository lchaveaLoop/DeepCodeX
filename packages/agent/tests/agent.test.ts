import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

// ── vi.mock hoisting: use vi.hoisted() for the mock ref ──
const { mockStream } = vi.hoisted(() => ({ mockStream: vi.fn() }));

vi.mock("../src/llm.js", () => ({
  streamAndAccumulate: mockStream,
}));

import { ToolRegistry } from "../src/tools/index.js";
import { readFileTool, writeFileTool } from "../src/tools/workspace.js";
import { setWorkspaceRoot } from "../src/config.js";
import type { StreamedResponse, ToolCall } from "../src/llm.js";

import { Agent } from "../src/agent.js";
import { saveSession, loadSession } from "../src/session.js";

function makeResp(
  content = "",
  toolCalls: ToolCall[] = [],
  reasoning: string | null = null,
): StreamedResponse {
  return { content, toolCalls, reasoning };
}

function makeTC(id: string, name: string, args: Record<string, unknown>): ToolCall {
  return { id, name, arguments: args };
}

describe("Agent loop", () => {
  beforeEach(() => {
    mockStream.mockReset();
  });

  it("direct answer no tools", async () => {
    mockStream.mockResolvedValueOnce(makeResp("Hello, world!"));

    const agent = new Agent(new ToolRegistry());
    const result = await agent.run("Hi!");

    expect(result).toBe("Hello, world!");
    expect(mockStream).toHaveBeenCalledTimes(1);
    expect(agent.currentRun?.status).toBe("completed");
    expect(agent.currentRun?.output).toBe("Hello, world!");
    expect(agent.currentRun?.steps.map((s) => s.kind)).toEqual([
      "user_message",
      "round_start",
      "llm_request",
      "llm_response",
      "assistant_message",
      "final",
    ]);
  });

  it("single round tool call", async () => {
    const registry = new ToolRegistry();
    registry.register(readFileTool);

    const root = path.join(os.tmpdir(), `fagent-agent-test-${Date.now()}`);
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(path.join(root, "x.py"), "print('hi')");
    setWorkspaceRoot(root);

    mockStream
      .mockResolvedValueOnce(makeResp("", [makeTC("c1", "read_file", { path: "x.py" })]))
      .mockResolvedValueOnce(makeResp("File contains: print('hi')"));

    const agent = new Agent(registry);
    const result = await agent.run("Read x.py");

    expect(result).toBe("File contains: print('hi')");
    expect(mockStream).toHaveBeenCalledTimes(2);
    expect(agent.currentRun?.status).toBe("completed");
    expect(agent.currentRun?.steps.map((s) => s.kind)).toContain("tool_call");
    expect(agent.currentRun?.steps.map((s) => s.kind)).toContain("tool_result");
    expect(agent.currentRun?.steps.find((s) => s.kind === "tool_call")).toMatchObject({
      toolCallId: "c1",
      toolName: "read_file",
      round: 1,
    });
  });

  it("multi round tool calls", async () => {
    const registry = new ToolRegistry();
    registry.register(readFileTool);

    const root = path.join(os.tmpdir(), `fagent-multi-${Date.now()}`);
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(path.join(root, "a.py"), "a");
    await fs.writeFile(path.join(root, "b.py"), "b");
    setWorkspaceRoot(root);

    mockStream
      .mockResolvedValueOnce(makeResp("", [makeTC("c1", "read_file", { path: "a.py" })]))
      .mockResolvedValueOnce(makeResp("", [makeTC("c2", "read_file", { path: "b.py" })]))
      .mockResolvedValueOnce(makeResp("Done."));

    const agent = new Agent(registry);
    const result = await agent.run("Read files");

    expect(result).toBe("Done.");
    expect(mockStream).toHaveBeenCalledTimes(3);
  });

  it("rejects unknown tool gracefully", async () => {
    mockStream
      .mockResolvedValueOnce(makeResp("", [makeTC("c1", "nonexistent", {})]))
      .mockResolvedValueOnce(makeResp("Recovered."));

    const agent = new Agent(new ToolRegistry());
    const result = await agent.run("X");

    expect(result).toBe("Recovered.");
  });

  it("max rounds enforced", async () => {
    const registry = new ToolRegistry();
    registry.register(readFileTool);

    const root = path.join(os.tmpdir(), `fagent-max-${Date.now()}`);
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(path.join(root, "x"), "data");
    setWorkspaceRoot(root);

    const config = await import("../src/config.js");

    // Always return tool_calls — will loop until max
    mockStream.mockResolvedValue(makeResp("", [makeTC("c1", "read_file", { path: "x" })]));

    const agent = new Agent(registry);
    const result = await agent.run("Loop");

    expect(result.toLowerCase()).toContain("maximum");
    expect(mockStream.mock.calls.length).toBe(config.MAX_TOOL_ROUNDS);
    expect(agent.currentRun?.status).toBe("max_rounds");
    expect(agent.currentRun?.totalRounds).toBe(config.MAX_TOOL_ROUNDS);
    expect(agent.currentRun?.steps.at(-1)?.kind).toBe("max_rounds");
  });

  it("passes reasoning_content back in assistant message", async () => {
    mockStream.mockResolvedValueOnce(
      makeResp("The answer is 42.", [], "Let me think..."),
    );

    const agent = new Agent(new ToolRegistry());
    await agent.run("?");

    const assistantMsgs = agent.messageHistory.filter(
      (m) => m.role === "assistant",
    );
    expect(assistantMsgs.length).toBe(1);
    expect((assistantMsgs[0] as any).reasoning_content).toBe("Let me think...");
  });

  it("confirms destructive tools via callback", async () => {
    const registry = new ToolRegistry();
    registry.register(writeFileTool);

    const root = path.join(os.tmpdir(), `fagent-confirm-${Date.now()}`);
    await fs.mkdir(root, { recursive: true });
    setWorkspaceRoot(root);

    mockStream
      .mockResolvedValueOnce(
        makeResp("", [makeTC("c1", "write_file", { path: "out.txt", content: "hi" })]),
      )
      .mockResolvedValueOnce(makeResp("Done writing."));

    let confirmCalled = false;
    const callbacks = {
      onConfirm: async (name: string, _args: Record<string, unknown>) => {
        confirmCalled = true;
        expect(name).toBe("write_file");
        return true;
      },
    };

    const agent = new Agent(registry, callbacks);
    const result = await agent.run("Write out.txt");

    expect(result).toBe("Done writing.");
    expect(confirmCalled).toBe(true);

    const written = await fs.readFile(path.join(root, "out.txt"), "utf-8");
    expect(written).toBe("hi");
  });

  it("rejects destructive tools when callback denies", async () => {
    const registry = new ToolRegistry();
    registry.register(writeFileTool);

    const root = path.join(os.tmpdir(), `fagent-deny-${Date.now()}`);
    await fs.mkdir(root, { recursive: true });
    setWorkspaceRoot(root);

    mockStream
      .mockResolvedValueOnce(
        makeResp("", [makeTC("c1", "write_file", { path: "x.txt", content: "bad" })]),
      )
      .mockResolvedValueOnce(makeResp("OK, I won't write that."));

    const callbacks = { onConfirm: async () => false };

    const agent = new Agent(registry, callbacks);
    const result = await agent.run("Write x.txt");

    expect(result).toBe("OK, I won't write that.");
    await expect(fs.access(path.join(root, "x.txt"))).rejects.toThrow();
    expect(agent.currentRun?.steps.map((s) => s.kind)).toContain("tool_rejected");
  });
});

describe("Session persistence", () => {
  it("roundtrips save and load", async () => {
    const dir = path.join(os.tmpdir(), `fagent-session-${Date.now()}`);
    await fs.mkdir(dir, { recursive: true });
    const filepath = path.join(dir, "session.json");

    const msgs = [
      { role: "system", content: "Hello" },
      { role: "user", content: "Hi" },
    ];

    await saveSession(msgs, filepath);
    const loaded = await loadSession(filepath);
    expect(loaded).toEqual(msgs);
  });
});
