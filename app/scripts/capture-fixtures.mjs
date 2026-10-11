// Capture real engine payloads into app/fixtures/ (component stories, unit tests).
//
//   node scripts/capture-fixtures.mjs [--data-root <abs dir>] [--real-model]
//
// Spawns the sidecar the way the Electron supervisor does (one ready line on stdout, token,
// port 0), reads a session that already exists in the data root (default <repo>\runs\dev_root,
// a copy of a real_run data root), and writes JSON fixtures. Nothing it calls writes to the
// session: previews, depth probes, a stale PUT that the engine refuses with 409, GETs.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoDir = path.resolve(appDir, "..");
const engineDir = path.join(repoDir, "engine");
const python = path.join(engineDir, ".venv", "Scripts", "python.exe");
const outDir = path.join(appDir, "fixtures");

function parseArgs(argv) {
  const out = { "data-root": null, "real-model": false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--data-root") out["data-root"] = argv[(i += 1)];
    else if (argv[i] === "--real-model") out["real-model"] = true;
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const dataRoot = path.resolve(args["data-root"] ?? path.join(repoDir, "runs", "dev_root"));
const token = randomBytes(32).toString("hex");

function startEngine() {
  const argv = ["-m", "nazeer_engine", "--data-root", dataRoot, "--port", "0", `--token=${token}`];
  if (!args["real-model"]) argv.push("--stub-model");
  const child = spawn(python, argv, {
    cwd: engineDir,
    env: { ...process.env, NAZEER_ENGINE_DEV: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const stderrTail = [];
  readline.createInterface({ input: child.stderr }).on("line", (line) => {
    stderrTail.push(line);
    if (stderrTail.length > 40) stderrTail.shift();
  });
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("no ready line within 180 s")), 180_000);
    readline.createInterface({ input: child.stdout }).on("line", (line) => {
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        return; // the contract is one JSON line; anything else is noise
      }
      if (event?.event === "ready") {
        clearTimeout(timer);
        resolve(event);
      } else if (event?.event === "fatal") {
        clearTimeout(timer);
        reject(new Error(`engine fatal ${event.code}: ${event.message}`));
      }
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`engine exited (${code}) before ready:\n${stderrTail.join("\n")}`));
    });
  });
  return { child, ready };
}

async function main() {
  const { child, ready } = startEngine();
  const event = await ready;
  const base = `http://127.0.0.1:${event.port}`;
  console.log(`engine ready: port ${event.port}, pid ${event.pid}, stub ${event.stub_model}`);

  async function call(method, route, { body, auth = true, expect = [200] } = {}) {
    const headers = {};
    if (auth) headers["X-Nazeer-Token"] = token;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(base + route, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!expect.includes(res.status)) {
      throw new Error(`${method} ${route} -> ${res.status}: ${text.slice(0, 400)}`);
    }
    return {
      status: res.status,
      etag: res.headers.get("etag"),
      json: text ? JSON.parse(text) : null,
    };
  }

  await mkdir(outDir, { recursive: true });
  const written = [];
  async function save(name, data) {
    await writeFile(
      path.join(outDir, `${name}.json`),
      `${JSON.stringify(data, null, 2)}\n`,
      "utf8",
    );
    written.push(name);
  }

  try {
    await save("health", (await call("GET", "/health", { auth: false })).json);
    await save("versions", (await call("GET", "/versions")).json);
    await save("labels", (await call("GET", "/meta/labels")).json);
    await save("recent_bags", (await call("GET", "/bags/recent")).json);

    const history = (await call("GET", "/sessions")).json;
    await save("history_list", history);
    const row = history.items.find((r) => r.index_state === "ok");
    if (!row) throw new Error("no session in the data root to capture");
    const sid = row.session_id;
    const opened = await call("GET", `/sessions/${sid}`);
    const view = opened.json;
    await save("session_view", view);

    const fingerprint = view.frame.bag.fingerprint;
    const sets = await readdir(path.join(dataRoot, "candidates", fingerprint));
    await save("candidate_set", (await call("GET", `/candidates/${fingerprint}/${sets[0]}`)).json);

    if (view.outputs.report_model) {
      await save("report_model", (await call("GET", view.outputs.report_model.url)).json);
    }

    // depth probes on points the real run placed: inside, outside (KNN snap), ground target
    const byId = new Map(view.measurements.map((m) => [m.id, m]));
    const knnRow = view.measurements.find((m) => m.presentation.n_points_knn > 0);
    const groundRow = view.measurements.find((m) => m.targets.includes("ground"));
    const insideRow = view.measurements.find((m) => m.kind === "distance_3d");
    const probes = [
      ["depth_inside", insideRow.input.points[0], "camel"],
      ["depth_outside_knn", knnRow.input.points[knnRow.input.points.length - 1], "camel"],
      ["depth_ground", groundRow.input.points[groundRow.targets.indexOf("ground")], "ground"],
    ];
    let seq = 0;
    for (const [name, [u, v], target] of probes) {
      seq += 1;
      await save(
        name,
        (await call("POST", `/sessions/${sid}/depth`, { body: { u, v, target, seq } })).json,
      );
    }

    // previews (never saved): a rejected row and every angle kind
    const curve = view.measurements.find((m) => m.kind === "curve_2d").input.points;
    const lines2d = view.measurements.filter((m) => m.kind === "distance_2d").map((m) => m.id);
    const lines3d = view.measurements.filter((m) => m.kind === "distance_3d").map((m) => m.id);
    const nextId = view.next_measurement_id;
    const previews = [
      [
        "preview_rejected",
        { kind: "distance_3d", name: "خارج الصورة", points: [[-40, 120], curve[0]] },
      ],
      [
        "preview_angle_2d_3point",
        { kind: "angle_2d_3point", name: "زاوية", points: [curve[2], curve[0], curve[4]] },
      ],
      [
        "preview_angle_3d_3point",
        { kind: "angle_3d_3point", name: "3D angle", points: [curve[2], curve[0], curve[4]] },
      ],
      [
        "preview_angle_2d_from_horizontal",
        { kind: "angle_2d_from_horizontal", name: "slope", points: [curve[0], curve[4]] },
      ],
      [
        "preview_angle_4point_2d",
        {
          kind: "angle_4point",
          name: "بين خطين",
          points: [],
          line_a_id: lines2d[0],
          line_b_id: lines2d[1],
        },
      ],
      [
        "preview_angle_4point_mixed",
        {
          kind: "angle_4point",
          name: "mixed",
          points: [],
          line_a_id: lines2d[0],
          line_b_id: lines3d[0],
        },
      ],
    ];
    for (const [name, m] of previews) {
      seq += 1;
      const body = { measurement: { id: nextId, note: "", ...m }, seq };
      await save(name, (await call("POST", `/sessions/${sid}/preview`, { body })).json);
    }

    // error envelopes; the stale PUT is refused before anything is written
    await save(
      "error_401_unauthorized",
      (await call("GET", "/versions", { auth: false, expect: [401] })).json,
    );
    await save(
      "error_404_session",
      (await call("GET", "/sessions/20000101_000000_abcdef", { expect: [404] })).json,
    );
    await save(
      "error_422_validation",
      (await call("POST", "/sessions", { body: {}, expect: [422] })).json,
    );
    const stale = { revision: 0, measurements: [] };
    await save(
      "error_409_stale_revision",
      (await call("PUT", `/sessions/${sid}/document`, { body: stale, expect: [409] })).json,
    );
    if (byId.size === 0) throw new Error("session has no measurements");

    // the upload probe recorded by the real run this data root came from
    const runs = path.join(repoDir, "runs");
    for (const name of (await readdir(runs))
      .filter((n) => n.startsWith("real_run_"))
      .sort()
      .reverse()) {
      const summary = JSON.parse(await readFile(path.join(runs, name, "summary.json"), "utf8"));
      if (summary.final?.history_row?.session_id === sid && summary.upload?.probe) {
        await save("probe_pass", summary.upload.probe);
        break;
      }
    }

    await save("_meta", {
      captured_at: new Date().toISOString(),
      engine_version: event.engine_version,
      stub_model: event.stub_model,
      data_root: dataRoot,
      session_id: sid,
      session_etag: opened.etag,
      files: [...written],
    });
  } finally {
    try {
      await call("POST", "/system/shutdown", { expect: [202] });
    } catch (error) {
      console.error(`shutdown request failed: ${error.message}`);
    }
    const exited = await Promise.race([
      new Promise((resolve) => child.once("exit", (code) => resolve(code))),
      new Promise((resolve) => setTimeout(() => resolve("timeout"), 15_000)),
    ]);
    if (exited === "timeout") child.kill();
    console.log(`engine exit: ${exited}`);
  }
  console.log(`wrote ${written.length} fixtures to ${outDir}: ${written.join(", ")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
