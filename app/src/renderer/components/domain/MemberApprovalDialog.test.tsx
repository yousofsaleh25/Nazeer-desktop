import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setEngineConnection } from "@/api/connection";
import { connectScriptedEngine } from "@/test/engine";
import { renderWithStore, uiState } from "@/test/render";
import { OVERLAY_BYTES, sha256Hex } from "@/test/sessionEngine";
import { fileOfUrl, MemberApprovalDialog } from "./MemberApprovalDialog";

afterEach(() => setEngineConnection(null));

const ID = "20261017_100000_aaaaaa";
const URL_PATH = `/sessions/${ID}/assets/overlay_v2.png`;

function setup(sha256: string, lang: "en" | "ar" = "en") {
  const engine = connectScriptedEngine({
    [`GET ${URL_PATH}`]: () =>
      new Response(OVERLAY_BYTES, { status: 200, headers: { "Content-Type": "image/png" } }),
  });
  const onApprove = vi.fn();
  renderWithStore(
    <MemberApprovalDialog
      open
      onOpenChange={vi.fn()}
      sessionId={ID}
      camelId="جمل-أ"
      overlay={{ version: 2, sha256, url: URL_PATH }}
      approved={null}
      onApprove={onApprove}
    />,
    { preloadedState: uiState(lang) },
  );
  return { engine, onApprove };
}

describe("MemberApprovalDialog", () => {
  it("shows the engine's image only when its fingerprint matches, then approves that version", async () => {
    const sha = await sha256Hex(OVERLAY_BYTES);
    const { onApprove } = setup(sha);
    expect(await screen.findByText("Fingerprint verified")).toBeInTheDocument();
    expect(screen.getByRole("img")).toHaveAttribute("src", expect.stringMatching(/^blob:/));
    expect(screen.getByText(`v2 · overlay_v2.png`)).toBeInTheDocument();
    expect(screen.getByText("جمل-أ")).toHaveAttribute("dir", "auto");
    await userEvent.click(screen.getByRole("button", { name: "Approve this image" }));
    expect(onApprove).toHaveBeenCalledWith({ version: 2, sha256: sha });
  });

  it("a mismatch shows no image and cannot be approved (Arabic)", async () => {
    const { onApprove } = setup("0".repeat(64), "ar");
    expect(await screen.findByText("الصورة لا تطابق بصمة المحرك")).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByRole("button", { name: "اعتماد هذه الصورة" })).toBeDisabled();
    expect(onApprove).not.toHaveBeenCalled();
  });

  it("names the file from the asset URL", () => {
    expect(fileOfUrl("/sessions/x/assets/overlay_v3.png?token=t")).toBe("overlay_v3.png");
    expect(fileOfUrl("/a/b/%D8%A7.png")).toBe("ا.png");
    expect(fileOfUrl("/a/b/%E0%A4%A.png")).toBe("%E0%A4%A.png");
  });
});
