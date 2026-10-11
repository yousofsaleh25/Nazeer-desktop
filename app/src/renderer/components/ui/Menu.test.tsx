import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Pencil, Trash2 } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import { renderWithStore } from "@/test/render";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "./Menu";

describe("DropdownMenu", () => {
  it("opens from its trigger and runs the chosen item", async () => {
    const onDelete = vi.fn();
    renderWithStore(
      <DropdownMenu>
        <DropdownMenuTrigger>Actions</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem icon={Pencil}>Rename</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem icon={Trash2} tone="danger" onSelect={onDelete}>
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    screen.getByRole("button", { name: "Actions" }).focus();
    await userEvent.keyboard("{Enter}");
    const remove = await screen.findByRole("menuitem", { name: "Delete" });
    expect(remove).toHaveClass("text-danger-text");
    await userEvent.click(remove);
    expect(onDelete).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("Popover", () => {
  it("shows its content as a dialog anchored to the trigger", async () => {
    renderWithStore(
      <Popover>
        <PopoverTrigger>Name it</PopoverTrigger>
        <PopoverContent aria-label="name">form</PopoverContent>
      </Popover>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Name it" }));
    expect(await screen.findByRole("dialog", { name: "name" })).toHaveTextContent("form");
  });
});
