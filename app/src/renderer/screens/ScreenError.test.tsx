import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Outlet } from "react-router";
import { renderRoutes, uiState } from "@/test/render";
import { routes } from "../routes";
import { ScreenError } from "./ScreenError";

function Boom(): never {
  throw new Error("kaboom: thumb_url points outside the engine");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a screen that fails while rendering", () => {
  it("shows its bilingual label, the error's message and the way back, inside the shell", () => {
    // React reports the caught error on the console; the test does not need it
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    renderRoutes(
      [
        {
          element: (
            <div>
              <nav>the shell</nav>
              <Outlet />
            </div>
          ),
          errorElement: <ScreenError />,
          children: [
            { errorElement: <ScreenError />, children: [{ path: "/", element: <Boom /> }] },
          ],
        },
      ],
      "/",
      { preloadedState: uiState("en") },
    );
    expect(screen.getByRole("navigation")).toHaveTextContent("the shell");
    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("data-code", "screen_failed");
    expect(alert).toHaveTextContent("This screen could not be shown");
    expect(alert).toHaveTextContent("kaboom: thumb_url points outside the engine");
    expect(screen.getByRole("link", { name: "Open a bag" })).toHaveAttribute("href", "/");
  });

  it("every operator screen sits under an error element inside the layout", () => {
    const [layout] = routes;
    expect(layout?.errorElement).toBeDefined();
    const [screens] = layout?.children ?? [];
    expect(screens?.errorElement).toBeDefined();
    expect(screens?.path).toBeUndefined();
    expect(screens?.children?.map((route) => route.path)).toContain("/sessions/:id");
  });
});
