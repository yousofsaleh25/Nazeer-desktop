import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithStore, uiState } from "@/test/render";
import { Field, Input, Textarea } from "./Field";

const label = { ar: "معرّف الجمل", en: "Camel ID" };
const hint = { ar: "مطلوب قبل الاعتماد", en: "Required before finalizing" };
const error = { ar: "قيمة غير صالحة", en: "Not a valid value" };

describe("Field", () => {
  it("labels its control and wires the hint and error to it", () => {
    renderWithStore(
      <Field label={label} hint={hint} error={error} required>
        <Input />
      </Field>,
      { preloadedState: uiState("en") },
    );
    const input = screen.getByLabelText(/Camel ID/);
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toBeRequired();
    const described = (input.getAttribute("aria-describedby") ?? "").split(" ");
    expect(described).toHaveLength(2);
    expect(document.getElementById(described[0]!)).toHaveTextContent(hint.en);
    expect(document.getElementById(described[1]!)).toHaveTextContent(error.en);
  });

  it("operator text is dir=auto (either script); paths can be forced left to right", () => {
    renderWithStore(
      <>
        <Field label={label}>
          <Input />
        </Field>
        <Input aria-label="path" dir="ltr" />
        <Textarea aria-label="notes" />
      </>,
    );
    expect(screen.getByLabelText(label.ar)).toHaveAttribute("dir", "auto");
    expect(screen.getByLabelText("path")).toHaveAttribute("dir", "ltr");
    expect(screen.getByLabelText("notes")).toHaveAttribute("dir", "auto");
  });

  it("a control outside a Field keeps its own attributes and is not invalid", () => {
    renderWithStore(<Input aria-label="free" id="x" />);
    const input = screen.getByLabelText("free");
    expect(input).toHaveAttribute("id", "x");
    expect(input).not.toHaveAttribute("aria-invalid");
  });
});
