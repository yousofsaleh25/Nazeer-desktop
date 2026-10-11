import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "./Table";

describe("Table", () => {
  it("text columns start-aligned, numeric columns end-aligned with tabular digits", () => {
    render(
      <Table>
        <TableHead>
          <tr>
            <TableHeaderCell>Name</TableHeaderCell>
            <TableHeaderCell numeric>Value</TableHeaderCell>
          </tr>
        </TableHead>
        <TableBody>
          <TableRow selected>
            <TableCell>ارتفاع</TableCell>
            <TableCell numeric>1.842</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    expect(screen.getByRole("columnheader", { name: "Name" })).toHaveClass("text-start");
    expect(screen.getByRole("columnheader", { name: "Value" })).toHaveAttribute("scope", "col");
    expect(screen.getByRole("cell", { name: "1.842" })).toHaveClass("text-end", "tabular-nums");
    expect(screen.getByRole("row", { name: /ارتفاع/ })).toHaveAttribute("aria-selected", "true");
  });
});
