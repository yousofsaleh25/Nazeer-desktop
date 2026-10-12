/** The engine's asset files the print page embeds: the pinned Plex face and the logo. */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const PRINT_FONT_FILE = "IBMPlexSansArabic-Regular.ttf";

/** The file's bytes, or null when it does not exist. */
export async function readEngineAsset(
  assetsDir: string,
  name: "font" | "logo",
): Promise<Uint8Array | null> {
  const file =
    name === "font" ? join(assetsDir, "fonts", PRINT_FONT_FILE) : join(assetsDir, "logo.png");
  try {
    return new Uint8Array(await readFile(file));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
