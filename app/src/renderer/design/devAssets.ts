/**
 * /design gallery only: the engine's asset paths mapped to the files of the dev data root
 * (runs/dev_root, the copied real_run session), served by the Vite dev server through /@fs/
 * (electron.vite.config.ts allows ../runs in dev). The app itself loads assets from the engine
 * with its token (Stage 4). Never imported by production code.
 */
import { fixtures } from "./fixtures";

const root = fixtures.meta.data_root.replaceAll("\\", "/");

function file(relative: string): string {
  return `/@fs/${root}/${relative}`;
}

export function devAssetUrl(enginePath: string): string {
  const url = new URL(enginePath, "http://engine.invalid");
  const parts = url.pathname.split("/").filter((p) => p.length > 0);
  // /sessions/<id>/assets/<file> → sessions/<id>/<file>
  if (parts[0] === "sessions" && parts[2] === "assets") {
    return file(`sessions/${parts[1]}/${parts.slice(3).join("/")}`);
  }
  // /sessions/<id>/report?v=N → sessions/<id>/report_vN.pdf
  if (parts[0] === "sessions" && parts[2] === "report") {
    return file(`sessions/${parts[1]}/report_v${url.searchParams.get("v") ?? "1"}.pdf`);
  }
  // /candidates/<fingerprint>/<params>/<id>/<file> → the same path
  return file(parts.join("/"));
}
