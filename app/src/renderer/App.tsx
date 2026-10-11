import { DirectionProvider } from "@radix-ui/react-direction";
import { useState } from "react";
import { RouterProvider } from "react-router/dom";
import { TooltipProvider } from "@/components/ui/Tooltip";
import { dirOf, LanguageProvider } from "@/design/language";
import { useDocumentPreferences } from "@/lib/document";
import { createRouter } from "./routes";
import { useAppSelector } from "./store/hooks";

export function App() {
  const { lang, bilingual, theme } = useAppSelector((state) => state.ui);
  useDocumentPreferences(lang, theme);
  const [router] = useState(createRouter);
  return (
    <DirectionProvider dir={dirOf(lang)}>
      <LanguageProvider lang={lang} bilingual={bilingual}>
        <TooltipProvider delayDuration={400}>
          <RouterProvider router={router} />
        </TooltipProvider>
      </LanguageProvider>
    </DirectionProvider>
  );
}
