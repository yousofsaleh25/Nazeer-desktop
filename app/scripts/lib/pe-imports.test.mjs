import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { API_SET, classifyImports, readPeImports, VC_RUNTIME } from "./pe-imports.mjs";

const work = mkdtempSync(path.join(os.tmpdir(), "nazeer-pe-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

/**
 * A minimal PE image with one section holding an import table, a delay-load import table and
 * their names (PE32+ unless `pe32`). `vaDelay` writes old-style VA-based delay descriptors.
 */
function buildPe({ imports, delayImports, pe32 = false, vaDelay = false }) {
  const optionalSize = pe32 ? 224 : 240;
  const sectionTable = 0x40 + 24 + optionalSize;
  const raw = 0x200;
  const rva = 0x1000;
  const imageBase = pe32 ? 0x10000000 : 0x180000000;
  const section = Buffer.alloc(0x400);
  let cursor = 0;
  const importAt = cursor;
  cursor += (imports.length + 1) * 20;
  const delayAt = cursor;
  cursor += (delayImports.length + 1) * 32;
  const nameRva = (name) => {
    const at = cursor;
    section.write(`${name}\0`, at, "latin1");
    cursor += name.length + 1;
    return rva + at;
  };
  imports.forEach((name, i) => section.writeUInt32LE(nameRva(name), importAt + i * 20 + 12));
  delayImports.forEach((name, i) => {
    const at = delayAt + i * 32;
    const nameAt = nameRva(name);
    section.writeUInt32LE(vaDelay ? 0 : 1, at);
    section.writeUInt32LE(vaDelay ? nameAt + imageBase : nameAt, at + 4);
  });

  const file = Buffer.alloc(raw + section.length);
  file.write("MZ", 0, "latin1");
  file.writeUInt32LE(0x40, 0x3c);
  file.write("PE\0\0", 0x40, "latin1");
  file.writeUInt16LE(pe32 ? 0x14c : 0x8664, 0x44);
  file.writeUInt16LE(1, 0x46);
  file.writeUInt16LE(optionalSize, 0x54);
  const optional = 0x58;
  file.writeUInt16LE(pe32 ? 0x10b : 0x20b, optional);
  if (pe32) file.writeUInt32LE(imageBase, optional + 28);
  else file.writeBigUInt64LE(BigInt(imageBase), optional + 24);
  const directories = optional + (pe32 ? 96 : 112);
  file.writeUInt32LE(16, directories - 4);
  if (imports.length > 0) file.writeUInt32LE(rva + importAt, directories + 8);
  if (delayImports.length > 0) file.writeUInt32LE(rva + delayAt, directories + 13 * 8);
  file.write(".rdata", sectionTable, "latin1");
  file.writeUInt32LE(section.length, sectionTable + 8);
  file.writeUInt32LE(rva, sectionTable + 12);
  file.writeUInt32LE(section.length, sectionTable + 16);
  file.writeUInt32LE(raw, sectionTable + 20);
  section.copy(file, raw);
  return file;
}

function write(name, bytes) {
  const file = path.join(work, name);
  writeFileSync(file, bytes);
  return file;
}

describe("readPeImports", () => {
  it("reads the import and delay-load tables of a PE32+ image", () => {
    const file = write(
      "a.pyd",
      buildPe({ imports: ["KERNEL32.dll", "python311.dll"], delayImports: ["MSVCP140.dll"] }),
    );
    expect(readPeImports(file)).toEqual({
      machine: "x64",
      imports: ["KERNEL32.dll", "python311.dll"],
      delayImports: ["MSVCP140.dll"],
    });
  });

  it("reads old-style VA-based delay descriptors of a PE32 image", () => {
    const file = write(
      "b.dll",
      buildPe({ imports: [], delayImports: ["user32.dll"], pe32: true, vaDelay: true }),
    );
    expect(readPeImports(file)).toEqual({
      machine: "x86",
      imports: [],
      delayImports: ["user32.dll"],
    });
  });

  it.runIf(process.platform === "win32")("reads a real executable (node.exe)", () => {
    const table = readPeImports(process.execPath);
    expect(table.machine).toBe(process.arch === "arm64" ? "arm64" : "x64");
    expect(table.imports.map((n) => n.toLowerCase())).toContain("kernel32.dll");
  });

  it("refuses files that are not PE images", () => {
    expect(() => readPeImports(write("c.dll", "not a binary"))).toThrow(/not a PE file/);
    const noSignature = buildPe({ imports: ["x.dll"], delayImports: [] });
    noSignature.write("XX", 0x40, "latin1");
    expect(() => readPeImports(write("d.dll", noSignature))).toThrow(/no PE signature/);
  });
});

describe("VC_RUNTIME and API_SET", () => {
  it("match the Visual C++ runtime family, not Windows' own C runtimes", () => {
    for (const name of [
      "msvcp140.dll",
      "MSVCP140_ATOMIC_WAIT.dll",
      "vcruntime140_1.dll",
      "VCRUNTIME140_THREADS.dll",
      "concrt140.dll",
      "vccorlib140.dll",
      "VCOMP140.DLL",
      "msvcr120.dll",
      "vcruntime140d.dll",
    ]) {
      expect(VC_RUNTIME.test(name), name).toBe(true);
    }
    for (const name of ["ucrtbase.dll", "msvcrt.dll", "kernel32.dll", "python311.dll"]) {
      expect(VC_RUNTIME.test(name), name).toBe(false);
    }
    expect(API_SET.test("api-ms-win-crt-runtime-l1-1-0.dll")).toBe(true);
    expect(API_SET.test("ext-ms-win-gdi-desktop-l1-1-0.dll")).toBe(true);
  });
});

describe("classifyImports", () => {
  const tables = new Map([
    [
      "python\\Lib\\site-packages\\torch\\lib\\c10.dll",
      {
        imports: ["KERNEL32.dll", "MSVCP140.dll", "api-ms-win-crt-heap-l1-1-0.dll"],
        delayImports: [],
      },
    ],
    [
      "python\\Lib\\site-packages\\cv2\\cv2.pyd",
      { imports: ["MFPlat.DLL", "libfoo.dll"], delayImports: ["nvcuda.dll"] },
    ],
  ]);
  const windows = (name) => ["kernel32.dll", "mfplat.dll", "msvcp140.dll"].includes(name);

  it("resolves names in the bundle and in Windows, ignores API sets, reports the rest", () => {
    const result = classifyImports(tables, new Set(["msvcp140.dll", "c10.dll"]), windows);
    expect(result.bundled).toEqual(["msvcp140.dll"]);
    expect(result.windows).toEqual(["kernel32.dll", "mfplat.dll"]);
    expect(result.missing).toEqual([
      {
        file: "python\\Lib\\site-packages\\cv2\\cv2.pyd",
        dll: "libfoo.dll",
        delay: false,
        vcRuntime: false,
      },
      {
        file: "python\\Lib\\site-packages\\cv2\\cv2.pyd",
        dll: "nvcuda.dll",
        delay: true,
        vcRuntime: false,
      },
    ]);
  });

  it("never counts a Visual C++ runtime DLL as part of Windows (System32 may hold a redistributable)", () => {
    const result = classifyImports(tables, new Set(["libfoo.dll", "nvcuda.dll"]), windows);
    expect(result.missing).toEqual([
      {
        file: "python\\Lib\\site-packages\\torch\\lib\\c10.dll",
        dll: "MSVCP140.dll",
        delay: false,
        vcRuntime: true,
      },
    ]);
  });
});
