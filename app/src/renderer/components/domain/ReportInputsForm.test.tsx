import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { reportFormContent } from "@/api/reportModel";
import type { ReportInputs } from "@/api/types";
import { fixtures } from "@/design/fixtures";
import { renderWithStore, uiState } from "@/test/render";
import { ReportInputsForm } from "./ReportInputsForm";

const content = reportFormContent(fixtures.reportModel)!;
const initial = fixtures.sessionView.report_inputs;

function Controlled({ onChange }: { onChange: (value: ReportInputs) => void }) {
  const [value, setValue] = useState<ReportInputs>(initial);
  return (
    <ReportInputsForm
      value={value}
      content={content}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

describe("ReportInputsForm", () => {
  it("shows the stored inputs with the engine's field labels and placeholders", () => {
    renderWithStore(<ReportInputsForm value={initial} content={content} onChange={() => {}} />, {
      preloadedState: uiState("en"),
    });
    expect(screen.getByRole("radio", { name: "Both" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("combobox", { name: "Scoring form" })).toHaveTextContent("Mjaheem");
    expect(screen.getByLabelText("Judge")).toHaveValue("حكم الاختبار");
    expect(screen.getByLabelText("Manual measurements")).toHaveValue(
      "تشغيل تجريبي: القياسات عشوائية وليست قياسات حكم.",
    );
    expect(screen.getByLabelText("Age Class")).toHaveAttribute(
      "placeholder",
      "نعش، حق، لقي، ثني، رباع، سداس / from teeth",
    );
  });

  it("every change reports the whole inputs object", async () => {
    const onChange = vi.fn();
    renderWithStore(<Controlled onChange={onChange} />, { preloadedState: uiState("en") });
    await userEvent.click(screen.getByRole("radio", { name: "Arabic" }));
    expect(onChange).toHaveBeenLastCalledWith({ ...initial, language: "ar" });
    await userEvent.type(screen.getByLabelText("Coat Quality"), "كثيف");
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ observations: { ...initial.observations, coat: "كثيف" } }),
    );
  });

  it("the colour is one of the engine's options; an unknown stored value is kept, not dropped", () => {
    renderWithStore(
      <ReportInputsForm
        value={{ ...initial, observations: { colour: "أشعل" } }}
        content={content}
        onChange={() => {}}
      />,
      { preloadedState: uiState("en") },
    );
    expect(screen.getByRole("combobox", { name: "Color" })).toHaveTextContent("أشعل");
  });

  it("disabled: nothing is editable", () => {
    renderWithStore(
      <ReportInputsForm value={initial} content={content} onChange={() => {}} disabled />,
      {
        preloadedState: uiState("en"),
      },
    );
    expect(screen.getByLabelText("Judge")).toBeDisabled();
  });
});
