/**
 * Engine files read as bytes outside the typed client: the report model, the sealed PDF, the
 * manifest. Fetched through the active engine (the token in the URL, see urls.ts), never cached
 * by the page; bytes the engine stamped with a SHA-256 are hashed with WebCrypto and compared
 * before they are shown (the PDF viewer says "verified" only then).
 */
import { useEffect, useState } from "react";
import { sha256Hex } from "@/lib/sha256";
import { activeEngine, ENGINE_NOT_CONNECTED } from "./connection";
import { errorFromResponse, networkError, type ApiErrorShape } from "./errors";
import { engineUrl } from "./urls";

export type Fetched<T> = { data: T } | { error: ApiErrorShape };

export async function fetchEngineBytes(path: string): Promise<Fetched<Uint8Array<ArrayBuffer>>> {
  const engine = activeEngine();
  if (engine === null) return { error: ENGINE_NOT_CONNECTED };
  try {
    const response = await engine.fetch(
      new Request(engineUrl(engine.connection, path), { cache: "no-store" }),
    );
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      return { error: errorFromResponse(response.status, body) };
    }
    return { data: new Uint8Array(await response.arrayBuffer()) };
  } catch (error) {
    return { error: networkError(error) };
  }
}

export async function fetchEngineJson(path: string): Promise<Fetched<unknown>> {
  const fetched = await fetchEngineBytes(path);
  if ("error" in fetched) return fetched;
  try {
    return { data: JSON.parse(new TextDecoder().decode(fetched.data)) as unknown };
  } catch (error) {
    return { error: networkError(error) };
  }
}

export type VerifiedBytes =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "match" | "mismatch"; bytes: Uint8Array<ArrayBuffer>; computed: string }
  | { state: "error"; error: ApiErrorShape };

/** The file at `path`, checked against the engine's `sha256` (null path: nothing to load). */
export function useVerifiedEngineBytes(
  path: string | null,
  sha256: string | null,
  retry = 0,
): VerifiedBytes {
  const [result, setResult] = useState<{ key: string; value: VerifiedBytes } | null>(null);
  const key = `${path ?? ""}|${sha256 ?? ""}|${retry}`;
  useEffect(() => {
    if (path === null) return;
    let alive = true;
    void fetchEngineBytes(path).then(async (fetched) => {
      if (!alive) return;
      if ("error" in fetched) {
        setResult({ key, value: { state: "error", error: fetched.error } });
        return;
      }
      const computed = await sha256Hex(fetched.data);
      if (!alive) return;
      const state = sha256 !== null && computed === sha256 ? "match" : "mismatch";
      setResult({ key, value: { state, bytes: fetched.data, computed } });
    });
    return () => {
      alive = false;
    };
  }, [path, sha256, key]);
  if (path === null) return { state: "idle" };
  return result?.key === key ? result.value : { state: "loading" };
}

export type LoadedJson =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ready"; data: unknown }
  | { state: "error"; error: ApiErrorShape };

/** The JSON file at `path` (null: nothing to load). */
export function useEngineJson(path: string | null, retry = 0): LoadedJson {
  const [result, setResult] = useState<{ key: string; value: LoadedJson } | null>(null);
  const key = `${path ?? ""}|${retry}`;
  useEffect(() => {
    if (path === null) return;
    let alive = true;
    void fetchEngineJson(path).then((fetched) => {
      if (!alive) return;
      setResult({
        key,
        value:
          "error" in fetched
            ? { state: "error", error: fetched.error }
            : { state: "ready", data: fetched.data },
      });
    });
    return () => {
      alive = false;
    };
  }, [path, key]);
  if (path === null) return { state: "idle" };
  return result?.key === key ? result.value : { state: "loading" };
}
