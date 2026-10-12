import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { MeasurementInput } from "@/api/types";
import { setEngineConnection } from "@/api/connection";
import { engineState } from "@/test/engine";
import { renderRoutes, uiState } from "@/test/render";
import { SessionEngine } from "@/test/sessionEngine";
import { MeasureScreen } from "./MeasureScreen";

const line = (id: number, name: string, points: [number, number][]): MeasurementInput => ({
  id,
  kind: "distance_2d",
  name,
  points,
  targets: ["camel", "camel"],
  color: "#BE2C2C",
  note: "",
});

function setup(prepare?: (engine: SessionEngine) => void) {
  const engine = new SessionEngine();
  prepare?.(engine);
  const view = renderRoutes(
    [{ path: "/sessions/:id", element: <MeasureScreen /> }],
    `/sessions/${engine.id}`,
    { preloadedState: { ...uiState("en"), engine: engineState() } },
  );
  return { engine, ...view, user: userEvent.setup() };
}

const puts = (engine: SessionEngine) => engine.requests.filter((r) => r.method === "PUT");
const lastPut = (engine: SessionEngine) =>
  puts(engine).at(-1)?.body as { revision: number; measurements: MeasurementInput[] };

async function canvas() {
  const element = await screen.findByRole("application", { name: /Measuring canvas/ });
  act(() => element.focus());
  return element;
}

afterEach(() => {
  setEngineConnection(null);
});

describe("the measuring screen", () => {
  it("draws a 2D distance with the keyboard crosshair, names it, and autosaves it", async () => {
    const { engine, user } = setup();
    await canvas();
    await user.keyboard("1"); // distance_2d
    expect(screen.getByText("click the two ends.")).toBeInTheDocument();
    // the crosshair starts at the middle of the frame (640, 360)
    await user.keyboard("{ArrowRight}{Enter}{Shift>}{ArrowRight}{/Shift}{Enter}");
    const name = await screen.findByRole("textbox", { name: /Measurement name/ });
    expect(name).toHaveFocus();
    await user.keyboard("withers height{Enter}");
    await waitFor(() => expect(puts(engine)).toHaveLength(1));
    expect(lastPut(engine)).toMatchObject({
      revision: 1,
      measurements: [
        {
          id: 1,
          kind: "distance_2d",
          name: "withers height",
          points: [
            [641, 360],
            [651, 360],
          ],
          targets: ["camel", "camel"],
        },
      ],
    });
    // the engine's row replaces the pending one, and the badge says saved
    const item = await screen.findByText("withers height", { selector: "li bdi" });
    await waitFor(() => expect(item.closest("li")).toHaveAttribute("data-status", "saved"));
    await waitFor(() =>
      expect(document.querySelector('span[role="status"][data-state]')).toHaveAttribute(
        "data-state",
        "clean",
      ),
    );
  });

  it("Shift+Enter places a ground point for a 3D kind; a curve finishes on its last point", async () => {
    const { engine, user } = setup();
    await canvas();
    // the first Enter only shows the crosshair, in the middle of the frame
    await user.keyboard("2{Enter}{ArrowDown}{Enter}{ArrowDown}{Shift>}{Enter}{/Shift}");
    await user.keyboard("chest depth{Enter}");
    await user.keyboard("3{Enter}{ArrowLeft}{Enter}{ArrowLeft}{Enter}{Enter}");
    await user.keyboard("back line{Enter}");
    await waitFor(() => expect(lastPut(engine)?.measurements).toHaveLength(2));
    const [chest, back] = lastPut(engine).measurements;
    expect(chest).toMatchObject({
      kind: "distance_3d",
      points: [
        [640, 361],
        [640, 362],
      ],
      targets: ["camel", "ground"],
    });
    expect(back).toMatchObject({
      kind: "curve_2d",
      points: [
        [640, 362],
        [639, 362],
        [638, 362],
      ],
      targets: ["camel", "camel", "camel"],
    });
  });

  it("Esc cancels the shape, then the tool; Backspace removes the last point", async () => {
    const { engine, user } = setup();
    const element = await canvas();
    const hint = () => document.getElementById(element.getAttribute("aria-describedby")!)!;
    await user.keyboard("3{ArrowRight}{Enter}{ArrowRight}{Enter}");
    expect(hint()).toHaveTextContent("points placed: 2");
    await user.keyboard("{Backspace}");
    expect(hint()).toHaveTextContent("points placed: 1");
    await user.keyboard("{Escape}");
    expect(hint()).not.toHaveTextContent("points placed");
    expect(element).toHaveAttribute("data-tool", "curve_2d");
    await user.keyboard("{Escape}");
    expect(element).toHaveAttribute("data-tool", "none");
    expect(puts(engine)).toHaveLength(0);
  });

  it("rename, delete with the Delete key, and undo it with Ctrl+Z", async () => {
    const { engine, user } = setup((e) => {
      e.inputs = [
        line(1, "withers", [
          [10, 10],
          [10, 90],
        ]),
        line(2, "rump", [
          [50, 10],
          [50, 90],
        ]),
      ];
      e.revision = 3;
      e.nextId = 3;
    });
    await canvas();
    await user.click(screen.getAllByRole("button", { name: "Measurement actions" })[0]!);
    await user.click(await screen.findByRole("menuitem", { name: "Rename" }));
    const dialog = await screen.findByRole("dialog", { name: "Rename the measurement" });
    const field = within(dialog).getByRole("textbox");
    await user.clear(field);
    await user.type(field, "withers height{Enter}");
    await waitFor(() => expect(lastPut(engine)?.measurements[0]?.name).toBe("withers height"));

    await user.click(screen.getByRole("button", { name: /rump/ }));
    await user.keyboard("{Delete}");
    await waitFor(() => expect(lastPut(engine)?.measurements).toHaveLength(1));
    await user.keyboard("{Control>}z{/Control}");
    await waitFor(() => expect(lastPut(engine)?.measurements).toHaveLength(2));
  });

  it("a 4-point angle picks two lines (saved first) and is named like a shape", async () => {
    const { engine, user } = setup((e) => {
      e.inputs = [
        line(1, "a", [
          [10, 10],
          [10, 90],
        ]),
        line(2, "b", [
          [50, 10],
          [90, 90],
        ]),
      ];
      e.revision = 1;
      e.nextId = 3;
    });
    await canvas();
    await user.keyboard("8");
    const picker = await screen.findByText("Lines of the angle");
    const card = picker.closest("section")!;
    await user.click(within(card).getByRole("button", { name: /^a/ }));
    await user.click(within(card).getByRole("button", { name: /^b/ }));
    await user.keyboard("neck angle{Enter}");
    await waitFor(() => expect(lastPut(engine)?.measurements).toHaveLength(3));
    expect(lastPut(engine).measurements[2]).toMatchObject({
      id: 3,
      kind: "angle_4point",
      name: "neck angle",
      line_a_id: 1,
      line_b_id: 2,
    });
  });

  it("a sealed session is read-only until reopened", async () => {
    const { engine, user } = setup((e) => {
      e.status = "exported";
      e.inputs = [
        line(1, "withers", [
          [10, 10],
          [10, 90],
        ]),
      ];
    });
    const element = await canvas();
    expect(screen.getByText("Read-only: the session is finalized")).toBeInTheDocument();
    await user.keyboard("1");
    expect(element).toHaveAttribute("data-tool", "none");
    expect(screen.queryByRole("button", { name: "Measurement actions" })).toBeNull();
    await user.click(screen.getAllByRole("button", { name: "Reopen for editing" })[0]!);
    await waitFor(() => expect(engine.status).toBe("open"));
    await waitFor(() =>
      expect(screen.queryByText("Read-only: the session is finalized")).toBeNull(),
    );
    await user.keyboard("1");
    expect(element).toHaveAttribute("data-tool", "distance_2d");
  });

  it("a change made elsewhere to the same measurement asks which version to keep", async () => {
    const { engine, user } = setup((e) => {
      e.inputs = [
        line(1, "withers", [
          [10, 10],
          [10, 90],
        ]),
      ];
      e.revision = 1;
      e.nextId = 2;
    });
    await canvas();
    engine.externalSave((inputs) => inputs.map((m) => ({ ...m, name: "theirs" })));
    await user.click(screen.getByRole("button", { name: "Measurement actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Rename" }));
    const field = within(await screen.findByRole("dialog")).getByRole("textbox");
    await user.clear(field);
    await user.type(field, "mine{Enter}");
    const alert = await screen.findByText("The session was changed elsewhere");
    expect(alert.closest('[role="alert"]')).toHaveTextContent("changed here and elsewhere");
    await user.click(screen.getByRole("button", { name: "Keep my version" }));
    await waitFor(() => expect(engine.inputs[0]?.name).toBe("mine"));
    expect(engine.revision).toBe(3);
  });
});
