/** Testing Library render with the app's providers (store, direction, language, labels, router). */
import { DirectionProvider } from "@radix-ui/react-direction";
import { TooltipProvider } from "@radix-ui/react-tooltip";
import { render, type RenderOptions } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router";
import labelsFixture from "../../../fixtures/labels.json";
import { parseLabels, type EngineLabels } from "@/api/labels";
import { LabelsProvider } from "@/components/domain/labels";
import { dirOf, LanguageProvider } from "@/design/language";
import { useAppSelector } from "@/store/hooks";
import { makeStore, type RootState } from "@/store/store";

/** The engine's real /meta/labels payload (app/fixtures/labels.json). */
export const fixtureLabels: EngineLabels = parseLabels(labelsFixture);

function LanguageBridge({ children }: { children: ReactNode }) {
  const { lang, bilingual } = useAppSelector((state) => state.ui);
  return (
    <DirectionProvider dir={dirOf(lang)}>
      <LanguageProvider lang={lang} bilingual={bilingual}>
        {children}
      </LanguageProvider>
    </DirectionProvider>
  );
}

export interface RenderWithStoreOptions extends Omit<RenderOptions, "wrapper"> {
  preloadedState?: Partial<RootState>;
  /** defaults to the real payload; null = labels not loaded yet */
  labels?: EngineLabels | null;
  /** wrap in a MemoryRouter at this path (components that render links) */
  route?: string;
}

export function renderWithStore(
  ui: ReactElement,
  { preloadedState, labels = fixtureLabels, route, ...options }: RenderWithStoreOptions = {},
) {
  const store = makeStore(preloadedState);
  function Wrapper({ children }: { children: ReactNode }) {
    const tree = (
      <Provider store={store}>
        <LanguageBridge>
          <LabelsProvider labels={labels}>
            <TooltipProvider delayDuration={0}>{children}</TooltipProvider>
          </LabelsProvider>
        </LanguageBridge>
      </Provider>
    );
    return route === undefined ? (
      tree
    ) : (
      <MemoryRouter initialEntries={[route]}>{tree}</MemoryRouter>
    );
  }
  return { store, ...render(ui, { wrapper: Wrapper, ...options }) };
}

/** Preloaded `ui` state for a language (and optionally both languages). */
export function uiState(lang: "ar" | "en", bilingual = false): Partial<RootState> {
  return { ui: { lang, bilingual, theme: "light" } };
}
