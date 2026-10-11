import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithStore, uiState } from "@/test/render";
import ComponentsGallery from "./ComponentsGallery";
import { devAssetUrl } from "./devAssets";
import DomainGallery from "./DomainGallery";
import { fixtures } from "./fixtures";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("/design/components", () => {
  it("renders every primitive section", () => {
    renderWithStore(<ComponentsGallery />, {
      route: "/design/components",
      preloadedState: uiState("en"),
    });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Component library");
    // the gallery sections (cards inside them have their own headings)
    expect(document.querySelectorAll("main > section > h2")).toHaveLength(13);
    expect(screen.getByRole("link", { name: "Components" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});

describe("/design/domain", () => {
  it("renders every domain section from the fixtures", async () => {
    // the dev data root is not served in tests: the asset fetches fail and say so
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(null, { status: 404 }))),
    );
    renderWithStore(<DomainGallery />, { route: "/design/domain", preloadedState: uiState("en") });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Domain components");
    // the gallery sections (cards inside them have their own headings)
    expect(document.querySelectorAll("main > section > h2")).toHaveLength(13);
    expect(
      screen.getAllByRole("img", { name: "Editing view: this canvas is never used for approval" }),
    ).toHaveLength(1);
    await waitFor(() => expect(screen.getAllByText("Request error").length).toBeGreaterThan(0));
  });
});

describe("devAssetUrl", () => {
  const root = fixtures.meta.data_root.replaceAll("\\", "/");
  it("maps engine asset paths to the dev data root's files", () => {
    expect(devAssetUrl("/sessions/20261011_152956_e20a7c/assets/rgb.png")).toBe(
      `/@fs/${root}/sessions/20261011_152956_e20a7c/rgb.png`,
    );
    expect(devAssetUrl("/sessions/20261011_152956_e20a7c/assets/overlay_v1.png?v=1")).toBe(
      `/@fs/${root}/sessions/20261011_152956_e20a7c/overlay_v1.png`,
    );
    expect(devAssetUrl("/sessions/20261011_152956_e20a7c/report?v=1")).toBe(
      `/@fs/${root}/sessions/20261011_152956_e20a7c/report_v1.pdf`,
    );
    expect(devAssetUrl("/candidates/fp/ph/c01_000805/thumb.jpg")).toBe(
      `/@fs/${root}/candidates/fp/ph/c01_000805/thumb.jpg`,
    );
  });
});
