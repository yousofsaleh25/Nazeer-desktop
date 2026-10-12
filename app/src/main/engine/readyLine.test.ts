import { describe, expect, it } from "vitest";
import { parseStdoutLine } from "./readyLine";

/** The ready line exactly as engine/nazeer_engine/__main__.py builds it. */
const READY = {
  event: "ready",
  port: 51234,
  pid: 36760,
  engine_version: "0.1.0",
  data_root: "E:\\camel_beauty\\nazeer-desktop\\runs\\dev_root",
  model_file: "best.pt",
  model_sha256: "0e9ee2baada7c70531b66e0b98f7e1cf4dcf3ce7971c55bce69a7270ec3a4320",
  stub_model: false,
  warmup_ms: 812.4,
  token_required: true,
  arabic_stack_ok: true,
  boot: { reconciled: { added: 0 } },
};

describe("parseStdoutLine", () => {
  it("reads the engine's ready line", () => {
    expect(parseStdoutLine(`${JSON.stringify(READY)}\r\n`)).toEqual({
      kind: "ready",
      port: 51234,
      pid: 36760,
      engineVersion: "0.1.0",
      dataRoot: READY.data_root,
      modelFile: "best.pt",
      modelSha256: READY.model_sha256,
      stubModel: false,
      warmupMs: 812.4,
      tokenRequired: true,
      arabicStackOk: true,
    });
  });

  it("keeps null model fields and a null warm-up (stub model)", () => {
    const line = JSON.stringify({
      ...READY,
      model_file: null,
      model_sha256: null,
      warmup_ms: null,
    });
    expect(parseStdoutLine(line)).toMatchObject({
      modelFile: null,
      modelSha256: null,
      warmupMs: null,
    });
  });

  it("reads a fatal line with its details", () => {
    const line = JSON.stringify({
      event: "fatal",
      code: "engine_already_running",
      message: "another engine is serving this data root",
      details: { pid: 4100, port: 50123 },
    });
    expect(parseStdoutLine(line)).toEqual({
      kind: "fatal",
      code: "engine_already_running",
      message: "another engine is serving this data root",
      details: { pid: 4100, port: 50123 },
    });
  });

  it("treats plain text and other JSON as noise", () => {
    expect(parseStdoutLine("INFO: something")).toEqual({ kind: "other", line: "INFO: something" });
    expect(parseStdoutLine("[1, 2]")).toEqual({ kind: "other", line: "[1, 2]" });
    expect(parseStdoutLine('{"event": "progress"}')).toEqual({
      kind: "other",
      line: '{"event": "progress"}',
    });
  });

  it("refuses a ready line it cannot trust, saying why", () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ port: null }, "port"], // the --check line
      [{ port: 0 }, "port"],
      [{ port: 70000 }, "port"],
      [{ port: "51234" }, "port"],
      [{ pid: 0 }, "pid"],
      [{ engine_version: 1 }, "engine_version"],
      [{ data_root: undefined }, "data_root"],
      [{ token_required: "yes" }, "token_required"],
      [{ stub_model: undefined }, "stub_model"],
      [{ arabic_stack_ok: null }, "arabic_stack_ok"],
    ];
    for (const [change, word] of cases) {
      const parsed = parseStdoutLine(JSON.stringify({ ...READY, ...change }));
      expect(parsed.kind, JSON.stringify(change)).toBe("other");
      expect(parsed.kind === "other" ? parsed.problem : "", JSON.stringify(change)).toContain(word);
    }
  });

  it("refuses a fatal line without a code", () => {
    const parsed = parseStdoutLine(JSON.stringify({ event: "fatal", message: "x" }));
    expect(parsed).toMatchObject({ kind: "other", problem: "fatal event without a code" });
  });
});
