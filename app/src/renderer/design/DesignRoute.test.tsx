import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderWithStore } from "@/test/render";
import DesignRoute from "./DesignRoute";

describe("/design gallery", () => {
  it("renders every section and reports that all contrast pairs pass", () => {
    renderWithStore(<DesignRoute />, { route: "/design" });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("نظام التصميم");
    expect(screen.getAllByRole("heading", { level: 2 }).length).toBeGreaterThanOrEqual(15);
    // "WCAG AA" sits in its own LTR isolate inside the Arabic sentence
    expect(document.body.textContent).toContain("جميع الأزواج تحقق مستوى WCAG AA في المظهرين.");
    // both themes are shown side by side
    expect(document.querySelectorAll('[data-theme="light"]').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('[data-theme="dark"]').length).toBeGreaterThan(0);
  });

  it("its language controls drive the ui slice", async () => {
    const { store } = renderWithStore(<DesignRoute />, { route: "/design" });
    await userEvent.click(screen.getByRole("button", { name: "English" }));
    expect(store.getState().ui.lang).toBe("en");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Design system");
  });
});
