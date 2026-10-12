/**
 * Static DLL dependencies of Windows PE files, for the engine bundle's DLL-closure check (D11):
 * the names in the import and delay-import tables, read from the headers without loading the
 * file. Only what the loader would ask for by name; DLLs loaded at runtime by LoadLibrary are
 * covered by the bundle's import smoke instead.
 */
import { closeSync, openSync, readSync } from "node:fs";

const MACHINES = { 0x8664: "x64", 0x14c: "x86", 0xaa64: "arm64" };
const MAX_DESCRIPTORS = 4096;

function readAt(fd, position, length) {
  const buffer = Buffer.alloc(length);
  const read = readSync(fd, buffer, 0, length, position);
  return buffer.subarray(0, read);
}

/** {machine, imports, delayImports} of a PE file (an .exe, .dll or .pyd). */
export function readPeImports(file) {
  const fd = openSync(file, "r");
  try {
    const dos = readAt(fd, 0, 64);
    if (dos.length < 64 || dos.readUInt16LE(0) !== 0x5a4d) {
      throw new Error(`${file}: not a PE file (no MZ header)`);
    }
    const peOffset = dos.readUInt32LE(0x3c);
    const coff = readAt(fd, peOffset, 24);
    if (coff.length < 24 || coff.readUInt32LE(0) !== 0x00004550) {
      throw new Error(`${file}: not a PE file (no PE signature)`);
    }
    const machineCode = coff.readUInt16LE(4);
    const sectionCount = coff.readUInt16LE(6);
    const optionalSize = coff.readUInt16LE(20);
    const optional = readAt(fd, peOffset + 24, optionalSize);
    const magic = optional.readUInt16LE(0);
    if (magic !== 0x20b && magic !== 0x10b) {
      throw new Error(`${file}: unknown optional header magic 0x${magic.toString(16)}`);
    }
    const pe32Plus = magic === 0x20b;
    const imageBase = pe32Plus ? optional.readBigUInt64LE(24) : BigInt(optional.readUInt32LE(28));
    const directoriesAt = pe32Plus ? 112 : 96;
    const directoryCount = optional.readUInt32LE(directoriesAt - 4);
    // a data directory's RVA (0 = absent): 1 = imports, 13 = delay-load imports
    const directory = (index) =>
      index < directoryCount ? optional.readUInt32LE(directoriesAt + index * 8) : 0;

    const table = readAt(fd, peOffset + 24 + optionalSize, sectionCount * 40);
    const sections = [];
    for (let i = 0; i < sectionCount; i += 1) {
      const entry = table.subarray(i * 40, i * 40 + 40);
      sections.push({
        virtualAddress: entry.readUInt32LE(12),
        span: Math.max(entry.readUInt32LE(8), entry.readUInt32LE(16)),
        rawPointer: entry.readUInt32LE(20),
      });
    }
    const offsetOf = (rva) => {
      for (const s of sections) {
        if (rva >= s.virtualAddress && rva < s.virtualAddress + s.span) {
          return s.rawPointer + (rva - s.virtualAddress);
        }
      }
      throw new Error(`${file}: RVA 0x${rva.toString(16)} is in no section`);
    };
    const cString = (rva) => {
      const bytes = readAt(fd, offsetOf(rva), 260);
      const end = bytes.indexOf(0);
      return bytes.subarray(0, end < 0 ? bytes.length : end).toString("latin1");
    };
    const walk = (rva, size, nameOf) => {
      const names = [];
      if (rva === 0) return names;
      let position = offsetOf(rva);
      for (let i = 0; i < MAX_DESCRIPTORS; i += 1) {
        const descriptor = readAt(fd, position, size);
        if (descriptor.length < size || descriptor.every((b) => b === 0)) return names;
        names.push(cString(nameOf(descriptor)));
        position += size;
      }
      throw new Error(`${file}: more than ${MAX_DESCRIPTORS} import descriptors`);
    };

    const imports = walk(directory(1), 20, (d) => d.readUInt32LE(12));
    // delay-load descriptors: attribute bit 0 set = RVAs (every modern linker), else VAs
    const delayImports = walk(directory(13), 32, (d) => {
      const name = d.readUInt32LE(4);
      return (d.readUInt32LE(0) & 1) === 1 ? name : Number(BigInt(name) - imageBase);
    });
    return {
      machine: MACHINES[machineCode] ?? `0x${machineCode.toString(16)}`,
      imports,
      delayImports,
    };
  } finally {
    closeSync(fd);
  }
}

/** The Visual C++ runtime family: never a Windows DLL, always shipped with the bundle. */
export const VC_RUNTIME =
  /^(msvcp\d+(_\w+)?|vcruntime\d+(_\w+)?|concrt\d+|vccorlib\d+|vcomp\d+|vcamp\d+|msvcr\d+)d?\.dll$/i;
/** API sets: virtual names the loader maps to Windows DLLs. */
export const API_SET = /^(api|ext)-ms-/i;

/**
 * Sort every imported name: in the bundle, a Windows DLL (`isWindowsDll(name)`), or missing. A
 * Visual C++ runtime DLL counts only when it is in the bundle (this machine's System32 copy would
 * hide its absence on a PC without the redistributable).
 *
 * @param {Map<string, {imports: string[], delayImports: string[]}>} tables file → its imports
 * @param {Set<string>} bundleNames lower-case file names of every file in the bundle
 * @param {(name: string) => boolean} isWindowsDll
 */
export function classifyImports(tables, bundleNames, isWindowsDll) {
  const missing = [];
  const bundled = new Set();
  const windows = new Set();
  for (const [file, table] of tables) {
    for (const [names, delay] of [
      [table.imports, false],
      [table.delayImports, true],
    ]) {
      for (const name of names) {
        const lower = name.toLowerCase();
        if (API_SET.test(lower)) continue;
        if (bundleNames.has(lower)) {
          bundled.add(lower);
        } else if (!VC_RUNTIME.test(lower) && isWindowsDll(lower)) {
          windows.add(lower);
        } else {
          missing.push({ file, dll: name, delay, vcRuntime: VC_RUNTIME.test(lower) });
        }
      }
    }
  }
  return { missing, bundled: [...bundled].sort(), windows: [...windows].sort() };
}
