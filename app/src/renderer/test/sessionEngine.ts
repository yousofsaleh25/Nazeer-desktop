/**
 * A simulated engine for the session store's tests, following the engine's own rules
 * (session_store.save_document / finalize): PUT at revision = stored + 1; the identical replay of
 * the stored revision is a 200; anything else at or below stored is 409 `stale_revision` with the
 * `current` view; a mismatching If-Match is a 409 too; the engine fills a missing colour (the echo
 * the store adopts); finalize applies the document first, then requires the stored revision and
 * renders an "overlay" whose bytes the test can corrupt. Failures are injected per request.
 */
import depthFixture from "../../../fixtures/depth_inside.json";
import reportModelFixture from "../../../fixtures/report_model.json";
import fixture from "../../../fixtures/session_view.json";
import type { FetchLike } from "@/api/client";
import { setEngineConnection } from "@/api/connection";
import type { DepthOut, MeasurementInput, MeasurementRow, SessionView } from "@/api/types";
import { sampleConnection } from "@/design/samples";

export interface SeenRequest {
  method: string;
  path: string;
  headers: Headers;
  body: unknown;
}

/**
 * An injected answer: a status + body; "network" (the request never arrives); "lost" (the engine
 * handles it, then the connection drops before the answer).
 */
export type Injected = { status: number; body: unknown } | "network" | "lost";

const TEMPLATE = (fixture as unknown as SessionView).measurements[0] as MeasurementRow;
const DEPTH = depthFixture as unknown as DepthOut;
export const OVERLAY_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);

export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export class SessionEngine {
  readonly id = (fixture as unknown as SessionView).session_id;
  revision = 0;
  status: SessionView["status"] = "open";
  inputs: MeasurementInput[] = [];
  camelId = "C-1";
  operator = "op";
  notes = "";
  nextId = 1;
  overlayVersion = 0;
  overlaySha256 = "";
  /** the SHA-256 finalize stamps (set it to the real hash of `overlayBytes`, or not) */
  overlayStamp = "";
  overlayBytes: Uint8Array<ArrayBuffer> = OVERLAY_BYTES;
  reportInputs: SessionView["report_inputs"] = (fixture as unknown as SessionView).report_inputs;
  /** the report model file the session names (the engine's real 1.1 model by default) */
  reportModel: unknown = reportModelFixture;
  /** the sealed report the view names (the fixture's v1 unless set) and the manifest file */
  report: SessionView["outputs"]["report"] | undefined = undefined;
  manifest: unknown = null;
  etagSalt = 0;
  readonly requests: SeenRequest[] = [];
  private gate: Promise<void> | null = null;
  private open: (() => void) | null = null;

  /** Hold every answer until resume() (requests are still recorded as they arrive). */
  pause(): void {
    this.gate = new Promise((resolve) => {
      this.open = resolve;
    });
  }

  resume(): void {
    this.open?.();
    this.gate = null;
    this.open = null;
  }
  /** answers injected for the next requests matching method + path suffix */
  private readonly injected: { method: string; suffix: string; answer: Injected }[] = [];

  constructor() {
    setEngineConnection(sampleConnection, this.fetch);
  }

  inject(method: string, suffix: string, answer: Injected): void {
    this.injected.push({ method, suffix, answer });
  }

  etag(): string {
    return `"r${this.revision}-${this.etagSalt}"`;
  }

  view(): SessionView {
    const base = fixture as unknown as SessionView;
    const rows = this.inputs.map((input, order) => ({
      ...TEMPLATE,
      id: input.id,
      kind: input.kind,
      name: input.name,
      order,
      input,
    })) as MeasurementRow[];
    return {
      ...base,
      session_id: this.id,
      camel_id: this.camelId,
      operator: this.operator,
      notes: this.notes,
      status: this.status,
      revision: this.revision,
      next_measurement_id: this.nextId,
      measurements: rows,
      report_inputs: this.reportInputs,
      outputs: {
        ...base.outputs,
        ...(this.report === undefined ? {} : { report: this.report }),
        overlay:
          this.overlayVersion === 0
            ? null
            : {
                version: this.overlayVersion,
                file: `overlay_v${this.overlayVersion}.png`,
                sha256: this.overlaySha256,
                width: 1280,
                height: 840,
                url: `/sessions/${this.id}/assets/overlay_v${this.overlayVersion}.png?v=${this.overlayVersion}`,
              },
      },
    };
  }

  /** Another client (or the engine itself) changes the document: the next PUT gets a 409. */
  externalSave(change: (inputs: MeasurementInput[]) => MeasurementInput[]): void {
    this.inputs = change(this.inputs);
    this.revision += 1;
  }

  private echo(input: MeasurementInput): MeasurementInput {
    return { ...input, color: input.color ?? "#BE2C2C" };
  }

  private save(body: Record<string, unknown>, ifMatch: string | null): Response {
    const revision = body["revision"] as number;
    const inputs = ((body["measurements"] as MeasurementInput[] | undefined) ?? []).map((i) =>
      this.echo(i),
    );
    const text = {
      camelId: (body["camel_id"] as string | undefined) ?? this.camelId,
      operator: (body["operator"] as string | undefined) ?? this.operator,
      notes: (body["notes"] as string | undefined) ?? this.notes,
    };
    const same =
      sameJson(inputs, this.inputs) &&
      text.camelId === this.camelId &&
      text.operator === this.operator &&
      text.notes === this.notes;
    const stale = (details: Record<string, unknown>) =>
      json(409, {
        error: {
          code: "stale_revision",
          message: "stale revision",
          details: { ...details, current: this.view() },
        },
      });
    if (revision <= this.revision) {
      if (revision === this.revision && same) return json(200, this.view(), { ETag: this.etag() });
      return stale({ stored_revision: this.revision, sent_revision: revision });
    }
    if (ifMatch !== null && ifMatch !== this.etag()) {
      return stale({ stored_revision: this.revision, if_match: ifMatch, etag: this.etag() });
    }
    this.inputs = inputs;
    ({ camelId: this.camelId, operator: this.operator, notes: this.notes } = text);
    const next = body["next_measurement_id"];
    this.nextId = Math.max(
      this.nextId,
      typeof next === "number" ? next : 1,
      ...inputs.map((i) => i.id + 1),
    );
    this.revision = revision;
    if (this.status !== "open") this.status = "open";
    return json(200, this.view(), { ETag: this.etag() });
  }

  readonly fetch: FetchLike = async (request) => {
    const url = new URL(request.url);
    const text = request.method === "GET" ? "" : await request.text();
    const body: unknown = text === "" ? undefined : JSON.parse(text);
    this.requests.push({
      method: request.method,
      path: url.pathname,
      headers: request.headers,
      body,
    });
    if (this.gate !== null) {
      // like fetch, an aborted request (a timed-out probe) rejects while it waits
      const signal = request.signal;
      await Promise.race([
        this.gate,
        new Promise((_resolve, reject) => {
          const abort = () => reject(new DOMException("The operation was aborted.", "AbortError"));
          if (signal.aborted) abort();
          signal.addEventListener("abort", abort);
        }),
      ]);
    }
    const index = this.injected.findIndex(
      (i) => i.method === request.method && url.pathname.endsWith(i.suffix),
    );
    const answer = index >= 0 ? this.injected.splice(index, 1)[0]?.answer : undefined;
    if (answer === "network") throw new TypeError("Failed to fetch");
    if (answer !== undefined && answer !== "lost") return json(answer.status, answer.body);
    const response = this.handle(request.method, url.pathname, body, request.headers);
    if (answer === "lost") throw new TypeError("Failed to fetch");
    return response;
  };

  private handle(method: string, path: string, body: unknown, headers: Headers): Response {
    const request = { method, headers };
    const url = { pathname: path };
    const base = `/sessions/${this.id}`;
    if (request.method === "GET" && url.pathname === base) {
      return json(200, this.view(), { ETag: this.etag() });
    }
    if (request.method === "PUT" && url.pathname === `${base}/document`) {
      return this.save(body as Record<string, unknown>, request.headers.get("If-Match"));
    }
    if (request.method === "POST" && url.pathname === `${base}/finalize`) {
      const payload = body as Record<string, unknown>;
      if (payload["document"] !== undefined) {
        const saved = this.save(
          { ...(payload["document"] as object), revision: payload["revision"] },
          null,
        );
        if (!saved.ok) return saved;
      }
      if (payload["revision"] !== this.revision) {
        return json(409, {
          error: {
            code: "stale_revision",
            message: "stale revision",
            details: { current: this.view() },
          },
        });
      }
      if (this.camelId.trim() === "") {
        return json(422, {
          error: { code: "camel_id_required", message: "set the camel id", details: {} },
        });
      }
      this.status = "finalized";
      this.overlayVersion += 1;
      this.overlaySha256 = this.overlayStamp;
      this.etagSalt += 1;
      return json(200, this.view(), { ETag: this.etag() });
    }
    if (request.method === "POST" && url.pathname === `${base}/reopen`) {
      this.status = "open";
      this.etagSalt += 1;
      return json(200, this.view(), { ETag: this.etag() });
    }
    if (request.method === "GET" && url.pathname.startsWith(`${base}/assets/overlay_v`)) {
      return new Response(this.overlayBytes, {
        status: 200,
        headers: { "Content-Type": "image/png" },
      });
    }
    if (request.method === "GET" && url.pathname.startsWith(`${base}/assets/report_model_v`)) {
      return json(200, this.reportModel);
    }
    if (
      request.method === "GET" &&
      url.pathname === `${base}/assets/report.manifest.json` &&
      this.manifest !== null
    ) {
      return json(200, this.manifest);
    }
    if (request.method === "PATCH" && url.pathname === `${base}/report-inputs`) {
      const patch = body as Partial<SessionView["report_inputs"]>;
      this.reportInputs = {
        ...this.reportInputs,
        ...(patch.language ? { language: patch.language } : {}),
        ...(patch.rubric_variant ? { rubric_variant: patch.rubric_variant } : {}),
        names: { ...this.reportInputs.names, ...(patch.names ?? {}) },
        observations: { ...this.reportInputs.observations, ...(patch.observations ?? {}) },
      };
      this.etagSalt += 1;
      return json(200, this.view(), { ETag: this.etag() });
    }
    if (request.method === "POST" && url.pathname === `${base}/depth`) {
      return json(200, { ...DEPTH, seq: (body as { seq: number }).seq });
    }
    if (request.method === "POST" && url.pathname === `${base}/preview`) {
      const { measurement, seq } = body as { measurement: MeasurementInput; seq: number };
      return json(200, { seq, row: { ...TEMPLATE, id: measurement.id, input: measurement } });
    }
    return json(404, { error: { code: "not_found", message: "Not Found", details: {} } });
  }
}
