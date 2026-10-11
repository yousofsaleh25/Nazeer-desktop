import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithStore, uiState } from "@/test/render";
import { Field } from "./Field";
import { Select } from "./Select";

const options = [
  { value: "mjaheem", label: { ar: "المجاهيم", en: "Mjaheem" } },
  { value: "maghateer", label: { ar: "المغاتير", en: "Maghateer" } },
] as const;

describe("Select", () => {
  it("shows the selected option's label in the UI language", () => {
    renderWithStore(
      <Select aria-label="variant" value="mjaheem" onValueChange={() => {}} options={options} />,
    );
    expect(screen.getByRole("combobox", { name: "variant" })).toHaveTextContent("المجاهيم");
  });

  it("picks an option with the keyboard", async () => {
    const onValueChange = vi.fn();
    renderWithStore(
      <Select
        aria-label="variant"
        value="mjaheem"
        onValueChange={onValueChange}
        options={options}
      />,
      { preloadedState: uiState("en") },
    );
    const trigger = screen.getByRole("combobox", { name: "variant" });
    trigger.focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.click(await screen.findByRole("option", { name: "Maghateer" }));
    expect(onValueChange).toHaveBeenCalledWith("maghateer");
  });

  it("inside a Field it takes the field's label", () => {
    renderWithStore(
      <Field label={{ ar: "الاستمارة", en: "Form" }}>
        <Select
          value={undefined}
          onValueChange={() => {}}
          options={options}
          placeholder={{ ar: "اختر", en: "Choose" }}
        />
      </Field>,
    );
    expect(screen.getByRole("combobox", { name: "الاستمارة" })).toHaveTextContent("اختر");
  });
});
