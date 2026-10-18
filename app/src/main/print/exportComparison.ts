/**
 * Print and seal a comparison (D12 F2.2, F2.9, F2.11): main's half, as exportPdf.ts is for one
 * session's report (pure orchestration; the window, the files and the engine are injected).
 *
 *  1. the comparison, fresh from the engine: not stale (a camel changed since it was made), and
 *     the comparison model the renderer names is its current one;
 *  2. every camel's image is approved: sealed in a report from its current image (the engine says
 *     `approved_by_seal`), or approved in the app — the version and SHA-256 the renderer sends;
 *  3. the comparison model bytes hash to the engine's stamp, are the version this page lays out,
 *     and name the camels and images the comparison view names, in the same order;
 *  4. each camel's overlay, fetched from the engine by main and hashed: it must be the approved
 *     bytes (byte identity by hash, the `--export` precedent; the renderer sends no bytes);
 *  5. the face and the logo; the hidden window lays the page out, checks it and prints it;
 *  6. the PDF goes to `POST /comparisons/{id}/report` with the model's hash and the app versions;
 *     the engine probes it (each camel's image on its own page, in order; each camel's names in its
 *     own pages), attaches the evidence and seals it — or refuses it.
 *
 * Expected failures resolve with `ok: false` and a code the renderer labels; nothing throws.
 */
import {
  MAX_OVERLAY_BYTES,
  PRINT_COMPARISON_MODEL_VERSION,
  type ComparisonExportRequest,
  type ComparisonExportResult,
  type ComparisonPrintOverlay,
  type ExportError,
  type PrintJob,
  type PrintPreflight,
} from "@shared/ipc";
import {
  appError,
  call,
  isRecord,
  json,
  printAssets,
  runPrint,
  sha256Hex,
  type ExportDeps,
  type PrintTimeouts,
} from "./exportPdf";

/** Measured in Stage 3 with headless Edge (20 camels: 8.3 s to print, 6.8 s to seal) and again in
 * Electron (D12 Stage 5); at least ten times the 20-camel figures. */
export const COMPARISON_PRINT_TIMEOUTS: PrintTimeouts = { layoutMs: 120_000, printMs: 120_000 };
export const COMPARISON_UPLOAD_TIMEOUT_MS = 180_000;

interface MemberFacts {
  position: number;
  sessionId: string;
  overlay: { version: number; sha256: string; url: string };
}

interface ComparisonFacts {
  members: MemberFacts[];
  model: { version: number; sha256: string; url: string };
  requiredTexts: string[];
}

/** The comparison view's facts the export needs, or why it cannot be printed now. */
export function checkComparison(
  view: unknown,
  request: ComparisonExportRequest,
): { facts: ComparisonFacts } | { error: ExportError } {
  if (!isRecord(view) || !isRecord(view["outputs"]) || !Array.isArray(view["members"])) {
    return { error: appError("invalid_response", "the engine's comparison view is not readable") };
  }
  const members: (MemberFacts & { approvedBySeal: boolean; staleReasons: unknown })[] = [];
  for (const raw of view["members"] as unknown[]) {
    const overlay = isRecord(raw) ? raw["overlay"] : null;
    if (
      !isRecord(raw) ||
      typeof raw["position"] !== "number" ||
      typeof raw["session_id"] !== "string" ||
      !isRecord(overlay) ||
      typeof overlay["version"] !== "number" ||
      typeof overlay["sha256"] !== "string" ||
      typeof overlay["url"] !== "string"
    ) {
      return { error: appError("invalid_response", "a camel of the comparison is not readable") };
    }
    members.push({
      position: raw["position"],
      sessionId: raw["session_id"],
      overlay: { version: overlay["version"], sha256: overlay["sha256"], url: overlay["url"] },
      approvedBySeal: raw["approved_by_seal"] === true,
      staleReasons: raw["stale_reasons"],
    });
  }
  if (members.length === 0) {
    return { error: appError("invalid_response", "the comparison has no camels") };
  }
  if (view["stale"] === true) {
    return {
      error: appError(
        "comparison_stale",
        "a camel's session changed after the comparison was made: compare again",
        {
          members: members
            .filter((m) => Array.isArray(m.staleReasons) && m.staleReasons.length > 0)
            .map((m) => ({
              position: m.position,
              session_id: m.sessionId,
              stale_reasons: m.staleReasons,
            })),
        },
      ),
    };
  }
  const model = view["outputs"]["model"];
  if (
    !isRecord(model) ||
    model["version"] !== request.model.version ||
    model["sha256"] !== request.model.sha256 ||
    typeof model["url"] !== "string"
  ) {
    return {
      error: appError(
        "comparison_model_mismatch",
        "the comparison's cover or language changed: print again",
        {
          requested: request.model,
          current: isRecord(model) ? { version: model["version"], sha256: model["sha256"] } : null,
        },
      ),
    };
  }
  // each camel: sealed in a report from its current image, or approved in the app (that image)
  const unapproved = members.filter(
    (m) =>
      !m.approvedBySeal &&
      !request.approvals.some(
        (a) =>
          a.sessionId === m.sessionId &&
          a.overlayVersion === m.overlay.version &&
          a.sha256 === m.overlay.sha256,
      ),
  );
  if (unapproved.length > 0) {
    return {
      error: appError(
        "comparison_approval_required",
        "approve each camel's image before printing the comparison",
        {
          members: unapproved.map((m) => ({
            position: m.position,
            session_id: m.sessionId,
            overlay_version: m.overlay.version,
          })),
        },
      ),
    };
  }
  const texts = view["required_report_texts"];
  if (!Array.isArray(texts) || texts.some((text) => typeof text !== "string")) {
    return {
      error: appError("invalid_response", "required_report_texts is not a list of strings"),
    };
  }
  return {
    facts: {
      members: members.map(({ position, sessionId, overlay }) => ({
        position,
        sessionId,
        overlay,
      })),
      model: { version: request.model.version, sha256: request.model.sha256, url: model["url"] },
      requiredTexts: texts as string[],
    },
  };
}

/** The model names the camels and images the view names, in the same order. */
export function modelMatchesView(model: unknown, members: MemberFacts[]): boolean {
  if (!isRecord(model) || !Array.isArray(model["members"])) return false;
  const named = model["members"] as unknown[];
  return (
    named.length === members.length &&
    named.every((m, i) => {
      const expected = members[i];
      const overlay = isRecord(m) ? m["overlay"] : null;
      return (
        expected !== undefined &&
        isRecord(m) &&
        m["session_id"] === expected.sessionId &&
        isRecord(overlay) &&
        overlay["sha256"] === expected.overlay.sha256 &&
        overlay["version"] === expected.overlay.version
      );
    })
  );
}

export async function exportComparison(
  request: ComparisonExportRequest,
  deps: ExportDeps,
): Promise<ComparisonExportResult> {
  const now = deps.now ?? (() => performance.now());
  const label = `comparison ${request.comparisonId}`;
  const timingsMs: Record<string, number> = {};
  let last = now();
  const lap = (step: string) => {
    const t = now();
    timingsMs[step] = Math.round(t - last);
    last = t;
  };
  const fail = (
    error: ExportError,
    extra: { probe?: unknown; preflight?: PrintPreflight | null } = {},
  ): ComparisonExportResult => {
    deps.log?.(`${label}: ${error.code} ${error.message}`);
    return {
      ok: false,
      error,
      probe: extra.probe ?? null,
      preflight: extra.preflight ?? null,
      timingsMs,
    };
  };

  const conn = deps.connection();
  if (conn === null) return fail(appError("engine_not_ready", "the engine is not connected"));
  const id = encodeURIComponent(request.comparisonId);

  // 1–2. the comparison as the engine has it now; every camel approved
  const viewCall = await call(deps, conn, `/comparisons/${id}`);
  if (!viewCall.ok) return fail(viewCall.error);
  const checked = checkComparison(json(viewCall.bytes), request);
  if ("error" in checked) return fail(checked.error);
  const { facts } = checked;

  // 3. the comparison model the page lays out
  const modelCall = await call(deps, conn, facts.model.url);
  if (!modelCall.ok) return fail(modelCall.error);
  const modelSha = sha256Hex(modelCall.bytes);
  if (modelSha !== facts.model.sha256) {
    return fail(
      appError(
        "comparison_model_hash_mismatch",
        "the comparison model bytes do not match the engine's stamp",
        { engine: facts.model.sha256, computed: modelSha },
      ),
    );
  }
  const model = json(modelCall.bytes);
  const schema = isRecord(model) ? model["comparison_model_version"] : undefined;
  if (schema !== PRINT_COMPARISON_MODEL_VERSION) {
    return fail(
      appError(
        "comparison_model_outdated",
        `the comparison model is version ${String(schema)}; this app prints version ` +
          `${PRINT_COMPARISON_MODEL_VERSION}: compare the camels again`,
        { version: schema ?? null, expected: PRINT_COMPARISON_MODEL_VERSION },
      ),
    );
  }
  if (!modelMatchesView(model, facts.members)) {
    return fail(
      appError(
        "comparison_model_mismatch",
        "the comparison model does not name the comparison's camels and images",
      ),
    );
  }
  lap("fetch");

  // 4. each camel's approved image, fetched and hashed here
  const overlays: ComparisonPrintOverlay[] = [];
  for (const member of facts.members) {
    const got = await call(deps, conn, member.overlay.url);
    if (!got.ok) return fail(got.error);
    if (got.bytes.byteLength > MAX_OVERLAY_BYTES) {
      return fail(
        appError("invalid_response", `camel #${member.position}'s image is too large`, {
          position: member.position,
          bytes: got.bytes.byteLength,
        }),
      );
    }
    const computed = sha256Hex(got.bytes);
    if (computed !== member.overlay.sha256) {
      return fail(
        appError("overlay_bytes_mismatch", "a camel's image is not the approved image", {
          position: member.position,
          session_id: member.sessionId,
          approved: member.overlay.sha256,
          computed,
        }),
      );
    }
    overlays.push({
      sessionId: member.sessionId,
      version: member.overlay.version,
      sha256: computed,
      bytes: new Uint8Array(got.bytes),
    });
  }
  lap("overlays");

  // 5. the face and the logo; lay out, check, print
  const assets = await printAssets(deps, label);
  if ("error" in assets) return fail(assets.error);
  const job: PrintJob = {
    kind: "comparison",
    model,
    comparisonModel: { version: facts.model.version, sha256: facts.model.sha256 },
    overlays,
    font: { sha256: assets.font.sha256, bytes: new Uint8Array(assets.font.bytes) },
    logo: assets.logo === null ? null : new Uint8Array(assets.logo),
    requiredTexts: facts.requiredTexts,
  };
  const printed = await runPrint(deps, job, COMPARISON_PRINT_TIMEOUTS);
  if ("error" in printed) return fail(printed.error);
  lap("print");
  const { preflight, pdf } = printed;
  if (!preflight.ok || pdf === null) {
    const first = preflight.problems[0];
    return fail(
      appError(first?.code ?? "print_failed", first?.message ?? "the print page was not printed", {
        problems: preflight.problems,
      }),
      { preflight },
    );
  }

  // 6. the engine probes, attaches the evidence and seals it
  const upload = await call(deps, conn, `/comparisons/${id}/report`, {
    method: "POST",
    body: pdf,
    timeoutMs: COMPARISON_UPLOAD_TIMEOUT_MS,
    headers: {
      "Content-Type": "application/pdf",
      "X-Comparison-Model-Sha256": facts.model.sha256,
      "X-App-Version": deps.appInfo.appVersion,
      "X-Electron": deps.appInfo.electron,
      "X-Chromium": deps.appInfo.chromium,
    },
  });
  lap("seal");
  if (!upload.ok) {
    const probe = upload.error.details["probe"];
    return fail(upload.error, { probe: probe ?? null, preflight });
  }
  const answer = json(upload.bytes);
  if (!isRecord(answer) || !isRecord(answer["comparison"]) || !isRecord(answer["probe"])) {
    return fail(appError("invalid_response", "the engine's answer to the upload is not readable"), {
      preflight,
    });
  }
  deps.log?.(
    `${label}: sealed (${facts.members.length} camels, ${pdf.byteLength} bytes printed, ` +
      `${JSON.stringify(timingsMs)})`,
  );
  return {
    ok: true,
    comparison: answer["comparison"],
    probe: answer["probe"],
    preflight,
    pdfBytes: pdf.byteLength,
    timingsMs,
  };
}
