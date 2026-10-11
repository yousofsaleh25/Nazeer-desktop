/**
 * The engine's /meta/labels for the component tree. The app feeds it from the store (Stage 5);
 * the /design gallery and the tests feed it the real payload in app/fixtures/labels.json. A code the
 * engine sent no label for renders as the raw code, never as a blank (D9).
 */
import { createContext, useCallback, useContext, type ReactNode } from "react";
import { labelOf, type EngineLabels, type LabelGroup, type LabelPair } from "@/api/labels";
import { Bi, type BiProps } from "@/components/ui/Bi";
import { Ltr } from "@/components/ui/Ltr";
import { useLanguage } from "@/design/language";
import { cn } from "@/lib/cn";

const LabelsContext = createContext<EngineLabels | null>(null);

export function LabelsProvider({
  labels,
  children,
}: {
  labels: EngineLabels | null;
  children: ReactNode;
}) {
  return <LabelsContext value={labels}>{children}</LabelsContext>;
}

export function useLabels(): EngineLabels | null {
  return useContext(LabelsContext);
}

export function useLabel(group: LabelGroup, code: string | null | undefined): LabelPair | null {
  return labelOf(useLabels(), group, code);
}

/** `(group, code) => string` in the UI language, falling back to the code (aria-label, title). */
export function useCodeString(): (group: LabelGroup, code: string) => string {
  const labels = useLabels();
  const { lang } = useLanguage();
  return useCallback(
    (group: LabelGroup, code: string) => labelOf(labels, group, code)?.[lang] ?? code,
    [labels, lang],
  );
}

export interface CodeLabelProps extends Pick<BiProps, "mode" | "block" | "className"> {
  group: LabelGroup;
  code: string;
}

/** An engine code's bilingual label; the raw code (left-to-right, monospace) when it has none. */
export function CodeLabel({ group, code, className, ...bi }: CodeLabelProps) {
  const pair = useLabel(group, code);
  if (pair !== null) return <Bi {...pair} {...bi} className={className} />;
  return <Ltr className={cn("font-mono text-[0.92em]", className)}>{code}</Ltr>;
}
