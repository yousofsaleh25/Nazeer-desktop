import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { setEngineConnection } from "@/api/connection";
import { forgetVerifiedOverlay } from "@/store/services/overlayBytes";
import { engineState } from "@/test/engine";
import { renderRoutes, uiState } from "@/test/render";
import { OVERLAY_BYTES, SessionEngine, sha256Hex } from "@/test/sessionEngine";
import { FinalizeScreen } from "./FinalizeScreen";

async function setup(prepare?: (engine: SessionEngine) => void) {
  const engine = new SessionEngine();
  engine.overlayStamp = await sha256Hex(OVERLAY_BYTES);
  engine.inputs = [
    {
      id: 1,
      kind: "distance_2d",
      name: "withers",
      points: [
        [10, 10],
        [10, 90],
      ],
      targets: ["camel", "camel"],
      color: "#BE2C2C",
      note: "",
    },
  ];
  engine.revision = 2;
  engine.nextId = 2;
  prepare?.(engine);
  const view = renderRoutes(
    [{ path: "/sessions/:id/finalize", element: <FinalizeScreen /> }],
    `/sessions/${engine.id}/finalize`,
    { preloadedState: { ...uiState("en"), engine: engineState() } },
  );
  return { engine, ...view, user: userEvent.setup() };
}

afterEach(() => {
  setEngineConnection(null);
  forgetVerifiedOverlay();
});

describe("finalize and approve", () => {
  it("finalize renders the engine's image; the verified bytes are shown and approved", async () => {
    const { engine, router, user } = await setup();
    const run = await screen.findByRole("button", { name: "Finalize: draw the engine's image" });
    await user.click(run);
    await waitFor(() => expect(engine.status).toBe("finalized"));
    expect(engine.requests.find((r) => r.path.endsWith("/finalize"))?.body).toEqual({
      revision: 2,
    });
    // the image shown is the verified bytes (a blob: URL), not a second download
    const image = await screen.findByRole("img", { name: /overlay image/ });
    expect(image.getAttribute("src")).toMatch(/^blob:/);
    expect(screen.getByText("Fingerprint verified")).toBeInTheDocument();
    const toReport = screen.getByRole("button", { name: "Continue to the report" });
    expect(toReport).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Approve this image" }));
    expect(await screen.findByText("Approved")).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "Continue to the report" }));
    expect(router.state.location.pathname).toBe(`/sessions/${engine.id}/report`);
  });

  it("the camel id is required: the field says so and finalize waits for it", async () => {
    const { engine, user } = await setup((e) => {
      e.camelId = "";
    });
    expect(await screen.findByText(/it is required to finalize/)).toBeInTheDocument();
    const run = screen.getByRole("button", { name: "Finalize: draw the engine's image" });
    expect(run).toBeDisabled();
    await user.type(screen.getByRole("textbox", { name: /Camel ID/ }), "C-12{Enter}");
    await waitFor(() => expect(engine.camelId).toBe("C-12"));
    await waitFor(() => expect(run).toBeEnabled());
  });

  it("an overlay that does not match the engine's stamp cannot be approved", async () => {
    const { user } = await setup((e) => {
      e.overlayStamp = "0".repeat(64);
    });
    await user.click(
      await screen.findByRole("button", { name: "Finalize: draw the engine's image" }),
    );
    expect(
      await screen.findByText("The image does not match the engine's fingerprint"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /overlay image/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Approve this image" })).toBeDisabled();
  });

  it("a sealed session opened here (History) gets its overlay checked again", async () => {
    const { engine } = await setup((e) => {
      e.status = "finalized";
      e.overlayVersion = 1;
      e.overlaySha256 = e.overlayStamp;
    });
    expect(await screen.findByRole("img", { name: /overlay image/ })).toBeInTheDocument();
    expect(engine.requests.some((r) => r.path.includes("/assets/overlay_v1.png"))).toBe(true);
  });
});
