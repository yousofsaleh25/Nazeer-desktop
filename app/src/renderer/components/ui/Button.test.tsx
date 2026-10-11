import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Trash2 } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import { renderWithStore } from "@/test/render";
import { Button, IconButton } from "./Button";

describe("Button", () => {
  it("is a type=button by default and fires onClick", async () => {
    const onClick = vi.fn();
    renderWithStore(<Button onClick={onClick}>Go</Button>);
    const button = screen.getByRole("button", { name: "Go" });
    expect(button).toHaveAttribute("type", "button");
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("loading: keeps the label, shows a spinner, blocks clicks", async () => {
    const onClick = vi.fn();
    renderWithStore(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button.querySelector("svg.animate-spin")).not.toBeNull();
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("variants and sizes meet the 32 px hit target", () => {
    renderWithStore(
      <>
        <Button variant="primary" size="sm">
          a
        </Button>
        <Button variant="danger" size="lg">
          b
        </Button>
      </>,
    );
    expect(screen.getByRole("button", { name: "a" })).toHaveClass("bg-primary", "min-h-8");
    expect(screen.getByRole("button", { name: "b" })).toHaveClass("bg-danger", "min-h-11");
  });

  it("asChild styles another element (e.g. a link) as a button", () => {
    renderWithStore(
      <Button asChild variant="primary">
        <a href="#/history">History</a>
      </Button>,
    );
    const link = screen.getByRole("link", { name: "History" });
    expect(link).toHaveClass("bg-primary");
    expect(link).not.toHaveAttribute("type");
  });
});

describe("IconButton", () => {
  it("has its label as accessible name and shows it as a tooltip on focus", async () => {
    renderWithStore(<IconButton icon={Trash2} label="Delete" />);
    const button = screen.getByRole("button", { name: "Delete" });
    expect(button.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    await userEvent.tab();
    expect(button).toHaveFocus();
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Delete");
  });

  it("directional icons mirror in right-to-left", () => {
    renderWithStore(<IconButton icon={Trash2} label="Next" directional />);
    expect(screen.getByRole("button", { name: "Next" }).querySelector("svg")).toHaveClass(
      "rtl:-scale-x-100",
    );
  });
});
