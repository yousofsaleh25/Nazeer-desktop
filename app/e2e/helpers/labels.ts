/**
 * UI labels by i18n key, read from the app's own string tables, so the specs follow a wording
 * change (the Arabic wording review) instead of breaking on it.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { appDir } from "./app";

export type Lang = "ar" | "en";
type Table = { [key: string]: string | Table };

function load(lang: Lang): Table {
  const file = path.join(appDir, "src", "renderer", "i18n", `${lang}.json`);
  return JSON.parse(readFileSync(file, "utf8")) as Table;
}

const tables: Record<Lang, Table> = { ar: load("ar"), en: load("en") };

export function label(lang: Lang, key: string): string {
  let node: string | Table | undefined = tables[lang];
  for (const part of key.split(".")) {
    node = typeof node === "object" ? node[part] : undefined;
  }
  if (typeof node !== "string") throw new Error(`no ${lang} label for ${key}`);
  return node;
}

/** `const t = labels("ar"); t("bag.browse")` */
export function labels(lang: Lang): (key: string) => string {
  return (key) => label(lang, key);
}
