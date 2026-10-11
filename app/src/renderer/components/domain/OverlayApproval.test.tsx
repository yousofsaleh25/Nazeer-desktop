import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { networkError } from "@/api/errors";
import { fixtures } from "@/design/fixtures";
import { renderWithStore, uiState } from "@/test/render";
import { OverlayApproval, type OverlayApprovalProps } from "./OverlayApproval";

const overlay = fixtures.sessionView.outputs.overlay!;

function setup(props: Partial<OverlayApprovalProps>) {
  const all: OverlayApprovalProps = {
    overlay,
    verification: { state: "verifying" },
    approved: null,
    onApprove: vi.fn(),
    onRetry: vi.fn(),
    ...props,
  };
  renderWithStore(<OverlayApproval {...all} />, { preloadedState: uiState("en") });
  return all;
}

describe("OverlayApproval", () => {
  it("always says that approval happens on the engine's image", () => {
    setup({});
    expect(screen.getByText("Approve on the engine's image")).toBeInTheDocument();
  });

  it("while verifying: no image, approval disabled", () => {
    setup({});
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByRole("button", { name: "Approve this image" })).toBeDisabled();
  });

  it("verified: the image from the checked bytes, approval possible", async () => {
    const props = setup({
      verification: { state: "match", computed: overlay.sha256, imageUrl: "blob:overlay" },
    });
    expect(screen.getByRole("img", { name: /overlay image/ })).toHaveAttribute(
      "src",
      "blob:overlay",
    );
    expect(screen.getByText("Fingerprint verified")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Approve this image" }));
    expect(props.onApprove).toHaveBeenCalledOnce();
  });

  it("a fingerprint mismatch is a hard error: no image, no approval, both hashes shown", () => {
    setup({ verification: { state: "mismatch", computed: "deadbeef".repeat(8) } });
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The image does not match the engine's fingerprint",
    );
    expect(screen.getByText(overlay.sha256)).toBeInTheDocument();
    expect(screen.getByText("deadbeef".repeat(8))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve this image" })).toBeDisabled();
  });

  it("an approval of this exact version and hash is shown; approving again is not offered", () => {
    setup({
      verification: { state: "match", computed: overlay.sha256, imageUrl: "blob:x" },
      approved: { version: overlay.version, sha256: overlay.sha256 },
    });
    expect(screen.getByText("Approved")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve this image" })).toBeDisabled();
  });

  it("a stale approval (other version) does not count", () => {
    setup({
      verification: { state: "match", computed: overlay.sha256, imageUrl: "blob:x" },
      approved: { version: overlay.version - 1, sha256: "old" },
    });
    expect(screen.queryByText("Approved")).toBeNull();
    expect(screen.getByRole("button", { name: "Approve this image" })).toBeEnabled();
  });

  it("a download failure offers a retry", async () => {
    const props = setup({
      verification: { state: "error", error: networkError(new Error("offline")) },
    });
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(props.onRetry).toHaveBeenCalledOnce();
  });
});
