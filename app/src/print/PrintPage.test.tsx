import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import modelFixture from "../../fixtures/report_model.json";
import sessionFixture from "../../fixtures/session_view.json";
import { parsePrintModel, type Language, type PrintModel } from "./model";
import { PrintPage } from "./PrintPage";

const REPORT_MODEL = { version: 1, sha256: "a".repeat(64) };

function renderPage(change: (model: PrintModel) => PrintModel = (m) => m) {
  const model = change(parsePrintModel(modelFixture));
  return render(
    <PrintPage
      model={model}
      overlayUrl="blob:overlay"
      logoUrl="blob:logo"
      reportModel={REPORT_MODEL}
    />,
  );
}

const withLanguage = (language: Language) => (m: PrintModel) => ({ ...m, language });

describe("the print page", () => {
  it("draws every string the engine's text probe requires, verbatim", () => {
    const { container } = renderPage();
    const required = (sessionFixture as { required_report_texts: string[] }).required_report_texts;
    expect(required.length).toBeGreaterThan(5);
    for (const text of required) expect(container.textContent, text).toContain(text);
  });

  it("lays out the engine's texts: frame block, counts, cross-check, provenance", () => {
    const { container } = renderPage();
    const text = container.textContent;
    const model = parsePrintModel(modelFixture);
    expect(text).toContain(model.frame.texts.z_ref.en);
    expect(text).toContain(model.frame.texts.z_ref.ar);
    expect(text).toContain(model.summary.countsText.en);
    expect(text).toContain(model.summary.snappedText.ar);
    expect(text).toContain(`sha256 ${REPORT_MODEL.sha256}`);
    expect(text).toContain(`${model.session.sessionId} · r${model.session.revision}`);
    const crossCheck = model.rows.find((r) => r.crossCheck !== null)?.crossCheck;
    expect(text).toContain(crossCheck?.ar);
  });

  it("shows the approved overlay full width, from the blob of the approved bytes", () => {
    renderPage();
    const overlay = document.querySelector<HTMLImageElement>('img[data-role="overlay"]');
    expect(overlay?.getAttribute("src")).toBe("blob:overlay");
    expect(overlay?.className).toContain("w-full");
    expect(overlay?.style.opacity).toBe("");
  });

  it("follows the report's language: Arabic only, English only, or both in their own isolates", () => {
    const arabic = renderPage(withLanguage("ar"));
    expect(screen.getAllByText("معلومات الجلسة").length).toBeGreaterThan(0);
    expect(screen.queryByText("Session Information")).toBeNull();
    arabic.unmount();

    const english = renderPage(withLanguage("en"));
    expect(screen.getAllByText("Session Information").length).toBeGreaterThan(0);
    expect(screen.queryByText("معلومات الجلسة")).toBeNull();
    english.unmount();

    renderPage(withLanguage("both"));
    const ar = screen.getByText("معلومات الجلسة");
    const en = screen.getByText("Session Information");
    expect(ar.closest("[dir]")?.getAttribute("dir")).toBe("rtl");
    expect(en.closest("[dir]")?.getAttribute("dir")).toBe("ltr");
  });

  it("operator text keeps its own direction; a rejected row shows no number, only the reasons", () => {
    const { container } = renderPage((m) => ({
      ...m,
      rows: m.rows.map((row, i) =>
        i === 0
          ? {
              ...row,
              rejected: true,
              rejection: [
                {
                  point: "p2",
                  code: "knn_too_far",
                  ar: "الجار الأقرب بعيد",
                  en: "nearest too far",
                },
              ],
            }
          : row,
      ),
    }));
    const camel = screen.getAllByText("جمل-تجربة-1")[0];
    expect(camel?.getAttribute("dir")).toBe("auto");
    const first = container.querySelectorAll("tbody")[2]?.querySelector("tr");
    expect(first?.textContent).toContain("مرفوض");
    expect(first?.textContent).toContain("nearest too far");
    const model = parsePrintModel(modelFixture);
    expect(first?.textContent).not.toContain(model.rows[0]?.valueText.en);
  });

  it("prints a text that is the same in both languages once, left to right", () => {
    const { container } = renderPage(withLanguage("both"));
    const model = parsePrintModel(modelFixture);
    const text = model.frame.texts.model.en; // "best.pt · sha256 0e9ee2baada7c705…"
    expect(model.frame.texts.model.ar).toBe(text);
    const shown = [...container.querySelectorAll("span")].filter((s) => s.textContent === text);
    expect(shown).toHaveLength(1);
    expect(shown[0]?.getAttribute("dir")).toBe("ltr");
  });

  it("keeps this computer's data folder off the printed page (it is in the attached files)", () => {
    const { container } = renderPage((m) => ({
      ...m,
      versions: [
        ...m.versions,
        ["data_root", String.raw`C:\Users\FieldUser42\AppData\Roaming\Nazeer Desktop`],
      ],
    }));
    expect(container.textContent).not.toContain("FieldUser42");
    expect(container.textContent).toContain("numpy");
  });

  it("never asks for a bold or italic face (a synthesized face breaks the text probe)", () => {
    const { container } = renderPage();
    expect(container.querySelectorAll("b, strong, i, em")).toHaveLength(0);
    expect(container.innerHTML).not.toMatch(/font-(bold|semibold|medium|black)|italic/);
  });
});
