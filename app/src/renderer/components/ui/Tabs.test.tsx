import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderWithStore } from "@/test/render";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./Tabs";

describe("Tabs", () => {
  it("switches panels by click and by arrow keys", async () => {
    renderWithStore(
      <Tabs defaultValue="a" dir="ltr">
        <TabsList aria-label="sections">
          <TabsTrigger value="a">A</TabsTrigger>
          <TabsTrigger value="b">B</TabsTrigger>
        </TabsList>
        <TabsContent value="a">panel a</TabsContent>
        <TabsContent value="b">panel b</TabsContent>
      </Tabs>,
    );
    expect(screen.getByRole("tabpanel")).toHaveTextContent("panel a");
    await userEvent.click(screen.getByRole("tab", { name: "B" }));
    expect(screen.getByRole("tabpanel")).toHaveTextContent("panel b");
    await userEvent.keyboard("{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "A" })).toHaveAttribute("aria-selected", "true");
  });
});
