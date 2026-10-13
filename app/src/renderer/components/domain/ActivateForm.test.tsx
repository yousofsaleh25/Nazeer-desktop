import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ActivationResult, LicenseReason, LicenseStatus } from "@shared/ipc";
import { renderWithStore, uiState } from "@/test/render";
import { ActivateForm } from "./ActivateForm";

const ACTIVE: LicenseStatus = {
  required: true,
  state: "active",
  reason: null,
  license: {
    kind: "trial",
    customer: null,
    expires: "2026-10-13T12:00:00Z",
    issued: "2026-10-12T12:00:00Z",
    fingerprint: "0123456789abcdef",
  },
  notSaved: false,
  configError: null,
};

function refused(reason: LicenseReason, expires: string | null = null): ActivationResult {
  return {
    accepted: false,
    reason,
    detail: "x",
    license:
      expires === null
        ? null
        : {
            kind: "trial",
            customer: null,
            expires,
            issued: "2026-10-01T00:00:00Z",
            fingerprint: "f",
          },
    status: { ...ACTIVE, state: "inactive", license: null },
  };
}

async function submit(key: string) {
  const user = userEvent.setup();
  await user.type(screen.getByRole("textbox"), key);
  await user.click(screen.getByRole("button", { name: /Activate/ }));
}

describe("ActivateForm", () => {
  it.each([
    ["malformed", "This is not a valid licence key", "هذا ليس مفتاح ترخيص صالحًا"],
    ["bad_signature", "was not issued for Nazeer", "لم يُصدر هذا المفتاح لنظير"],
    ["expired", "This licence key has expired", "انتهت صلاحية مفتاح الترخيص هذا"],
  ] as const)(
    "a %s key is explained in Arabic and English, whatever the UI language",
    async (reason, en, ar) => {
      const activate = vi.fn(() =>
        Promise.resolve(refused(reason, reason === "expired" ? "2026-10-11T00:00:00Z" : null)),
      );
      const onAccepted = vi.fn();
      renderWithStore(<ActivateForm activate={activate} onAccepted={onAccepted} />, {
        preloadedState: uiState("en"),
      });
      await submit("NZL1.abc.def");
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(en);
      expect(alert).toHaveTextContent(ar);
      expect(activate).toHaveBeenCalledWith("NZL1.abc.def");
      expect(onAccepted).not.toHaveBeenCalled();
      if (reason === "expired") expect(alert).toHaveTextContent("2026-10-1");
    },
  );

  it("an accepted key hands the new status to the caller", async () => {
    const activate = vi.fn(() =>
      Promise.resolve({
        accepted: true,
        reason: null,
        detail: "",
        license: ACTIVE.license,
        status: ACTIVE,
      } satisfies ActivationResult),
    );
    const onAccepted = vi.fn();
    renderWithStore(<ActivateForm activate={activate} onAccepted={onAccepted} />, {
      preloadedState: uiState("ar"),
    });
    await submit("NZL1.good.key");
    await vi.waitFor(() => expect(onAccepted).toHaveBeenCalledWith(ACTIVE));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a key that verified but could not be saved says so before the app opens", async () => {
    const status: LicenseStatus = { ...ACTIVE, notSaved: true };
    const activate = vi.fn(() =>
      Promise.resolve({
        accepted: true,
        reason: null,
        detail: "",
        license: ACTIVE.license,
        status,
      } satisfies ActivationResult),
    );
    const onAccepted = vi.fn();
    renderWithStore(<ActivateForm activate={activate} onAccepted={onAccepted} />, {
      preloadedState: uiState("en"),
    });
    await submit("NZL1.good.key");
    // a warning: announced politely (role status), not as an error
    const alert = await screen.findByRole("status");
    expect(alert).toHaveTextContent("it will be asked for again at the next start");
    expect(alert).toHaveTextContent("سيُطلب مرة أخرى عند التشغيل التالي");
    expect(onAccepted).not.toHaveBeenCalled();
    await userEvent.setup().click(screen.getByRole("button", { name: /Continue/ }));
    expect(onAccepted).toHaveBeenCalledWith(status);
  });

  it("the key field is left to right and the button waits for a key", () => {
    renderWithStore(<ActivateForm activate={vi.fn()} onAccepted={vi.fn()} />, {
      preloadedState: uiState("ar"),
    });
    expect(screen.getByRole("textbox")).toHaveAttribute("dir", "ltr");
    expect(screen.getByRole("button", { name: /تفعيل/ })).toBeDisabled();
  });
});
