import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LicenseStatus, NazeerApi } from "@shared/ipc";
import { renderWithStore, uiState } from "@/test/render";
import { LicenseCard } from "./LicenseCard";
import { LicenseGate } from "./LicenseGate";

const base: LicenseStatus = {
  required: true,
  state: "inactive",
  reason: null,
  license: null,
  notSaved: false,
  configError: null,
};

function withBridge(status: LicenseStatus) {
  (window as { nazeer?: Partial<NazeerApi> }).nazeer = {
    license: {
      getStatus: vi.fn(() => Promise.resolve(status)),
      activate: vi.fn(),
    },
  };
}

afterEach(() => {
  delete (window as { nazeer?: NazeerApi }).nazeer;
});

function renderGate() {
  return renderWithStore(
    <LicenseGate>
      <p>the app</p>
    </LicenseGate>,
    { preloadedState: uiState("en") },
  );
}

describe("LicenseGate", () => {
  it("first run: the Activate screen, in both languages, instead of the app", async () => {
    withBridge(base);
    renderGate();
    expect(
      await screen.findByRole("heading", { level: 1, name: /Activate Nazeer/ }),
    ).toHaveTextContent("تفعيل نظير");
    expect(screen.queryByText("the app")).toBeNull();
  });

  it("a stored trial that ran out says so, with its date", async () => {
    withBridge({
      ...base,
      reason: "expired",
      license: {
        kind: "trial",
        customer: null,
        expires: "2026-10-11T12:00:00Z",
        issued: "2026-10-10T12:00:00Z",
        fingerprint: "0123456789abcdef",
      },
    });
    renderGate();
    expect(
      await screen.findByText("The trial has ended. Enter a new key to continue."),
    ).toBeVisible();
    expect(screen.getByText("انتهت الفترة التجريبية. أدخل مفتاحًا جديدًا للمتابعة.")).toBeVisible();
  });

  it("a build without a public key says it cannot check keys", async () => {
    withBridge({ ...base, configError: "license_not_configured" });
    renderGate();
    expect(await screen.findByText(/has no licence public key/)).toBeVisible();
  });

  it("an active licence, or none required, shows the app", async () => {
    withBridge({ ...base, state: "active" });
    renderGate();
    expect(await screen.findByText("the app")).toBeVisible();
  });

  it("without the bridge (tests, a browser) nothing is required", async () => {
    renderGate();
    expect(await screen.findByText("the app")).toBeVisible();
  });
});

describe("LicenseCard", () => {
  it("shows the active licence and offers Change key", () => {
    withBridge(base);
    renderWithStore(<LicenseCard />, {
      preloadedState: {
        ...uiState("en"),
        license: {
          status: {
            ...base,
            state: "active",
            license: {
              kind: "permanent",
              customer: "مهرجان الظفرة",
              expires: null,
              issued: "2026-10-12T12:00:00Z",
              fingerprint: "0123456789abcdef",
            },
          },
        },
      },
    });
    expect(screen.getByRole("heading", { name: "Licence" })).toBeVisible();
    expect(screen.getByText("Permanent")).toBeVisible();
    expect(screen.getByText("مهرجان الظفرة")).toBeVisible();
    expect(screen.getByText("No expiry")).toBeVisible();
    expect(screen.getByRole("button", { name: "Change key" })).toBeVisible();
  });

  it("a development build without enforcement says no licence is needed", () => {
    renderWithStore(<LicenseCard />, {
      preloadedState: {
        ...uiState("en"),
        license: { status: { ...base, required: false, state: "active" } },
      },
    });
    expect(screen.getByText("No licence needed in this development build")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Change key" })).toBeNull();
  });
});
