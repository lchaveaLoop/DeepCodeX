import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { ToolRegistry } from "../src/tools/index.js";
import { readFileTool, writeFileTool, ReadFileArgs, WriteFileArgs } from "../src/tools/workspace.js";
import { runCommandTool } from "../src/tools/shell.js";
import { WebSearchArgs } from "../src/tools/web-search.js";
import { setWorkspaceRoot } from "../src/config.js";

let testRoot: string;

beforeAll(async () => {
  testRoot = path.join(os.tmpdir(), `fagent-test-root-${Date.now()}`);
  await fs.mkdir(testRoot, { recursive: true });
  setWorkspaceRoot(testRoot);
});

describe("ToolRegistry", () => {
  it("registers and lists tools", () => {
    const reg = new ToolRegistry();
    reg.register(readFileTool);
    reg.register(writeFileTool);

    expect(reg.listNames()).toContain("read_file");
    expect(reg.listNames()).toContain("write_file");
    expect(reg.listNames().length).toBe(2);
  });

  it("returns error for unknown tool", async () => {
    const reg = new ToolRegistry();
    const result = await reg.execute("nonexistent", {});
    expect(result).toContain("Error");
  });
});

describe("read_file", () => {
  it("reads file content", async () => {
    await fs.writeFile(path.join(testRoot, "hello.ts"), "const x = 1;\nconst y = 2;\n");

    const result = await readFileTool.handler({ path: "hello.ts" });
    expect(result).toContain("const x = 1");
    expect(result).toContain("const y = 2");
  });

  it("handles line range", async () => {
    await fs.writeFile(path.join(testRoot, "nums.txt"), "one\ntwo\nthree\nfour\nfive\n");

    const result = await readFileTool.handler({ path: "nums.txt", startLine: 2, endLine: 4 });
    expect(result).toContain("two");
    expect(result).toContain("four");
    expect(result).not.toContain("one");
  });

  it("rejects escape attempts", async () => {
    const result = await readFileTool.handler({ path: "../../../etc/passwd" });
    expect(result).toContain("escapes workspace");
  });

  it("rejects missing file", async () => {
    const result = await readFileTool.handler({ path: "no.txt" });
    expect(result).toContain("file not found");
  });
});

describe("write_file", () => {
  it("writes and reports byte count", async () => {
    const result = await writeFileTool.handler({ path: "out.txt", content: "hello world" });
    expect(result).toContain("Wrote");
    expect(result).toContain("out.txt");

    const written = await fs.readFile(path.join(testRoot, "out.txt"), "utf-8");
    expect(written).toBe("hello world");
  });

  it("rejects escape", async () => {
    const result = await writeFileTool.handler({ path: "../out.txt", content: "x" });
    expect(result).toContain("escapes workspace");
  });
});

describe("run_command", () => {
  it("executes a simple command", async () => {
    const result = runCommandTool.handler({ command: "echo hello" });
    expect(result).toContain("hello");
  });
});

describe("web_search", () => {
  it("validates args with Zod", () => {
    const parsed = WebSearchArgs.safeParse({ query: "test", topK: 3 });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.topK).toBe(3);
    }
  });

  it("rejects missing query", () => {
    const parsed = WebSearchArgs.safeParse({});
    expect(parsed.success).toBe(false);
  });
});

describe("Zod validation", () => {
  it("ReadFileArgs rejects non-string path", () => {
    const r = ReadFileArgs.safeParse({ path: 123 });
    expect(r.success).toBe(false);
  });

  it("WriteFileArgs requires content", () => {
    const r = WriteFileArgs.safeParse({ path: "x" });
    expect(r.success).toBe(false);
  });
});
