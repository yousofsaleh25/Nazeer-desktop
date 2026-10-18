/** Hash routes (the app is served from app://nazeer/renderer/index.html). */
import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from "react";
import { createHashRouter, type RouteObject } from "react-router";
import { About } from "./screens/About";
import { Candidates } from "./screens/Candidates";
import { CandidateSet } from "./screens/CandidateSet";
import { ComparisonScreen } from "./screens/ComparisonScreen";
import { FinalizeScreen } from "./screens/FinalizeScreen";
import { HistoryScreen } from "./screens/HistoryScreen";
import { Home } from "./screens/Home";
import { MeasureScreen } from "./screens/measure/MeasureScreen";
import { NotFound } from "./screens/NotFound";
import { OperatorLayout } from "./screens/OperatorLayout";
import { ReportScreen } from "./screens/ReportScreen";
import { ScreenError } from "./screens/ScreenError";

function page(Component: LazyExoticComponent<ComponentType>) {
  return (
    <Suspense fallback={null}>
      <Component />
    </Suspense>
  );
}

/** The /design gallery exists only in development builds; the production bundle does not contain it. */
function devRoutes(): RouteObject[] {
  if (!import.meta.env.DEV) return [];
  const Tokens = lazy(() => import("./design/DesignRoute"));
  const Components = lazy(() => import("./design/ComponentsGallery"));
  const Domain = lazy(() => import("./design/DomainGallery"));
  return [
    { path: "/design", element: page(Tokens) },
    { path: "/design/components", element: page(Components) },
    { path: "/design/domain", element: page(Domain) },
  ];
}

/**
 * Operator screens sit in OperatorLayout (shell + engine gate); the gallery stands alone. A screen
 * that throws while rendering shows ScreenError in place of the screen, inside the shell (the
 * pathless route); the layout's own error element is the last resort, without the shell.
 */
export const routes: RouteObject[] = [
  {
    element: <OperatorLayout />,
    errorElement: <ScreenError />,
    children: [
      {
        errorElement: <ScreenError />,
        children: [
          { path: "/", element: <Home /> },
          { path: "/candidates", element: <Candidates /> },
          { path: "/candidates/:fp/:ph", element: <CandidateSet /> },
          { path: "/sessions/:id", element: <MeasureScreen /> },
          { path: "/sessions/:id/finalize", element: <FinalizeScreen /> },
          { path: "/sessions/:id/report", element: <ReportScreen /> },
          { path: "/history", element: <HistoryScreen /> },
          { path: "/comparisons/:id", element: <ComparisonScreen /> },
          { path: "/about", element: <About /> },
          { path: "*", element: <NotFound /> },
        ],
      },
    ],
  },
  ...devRoutes(),
];

export function createRouter() {
  return createHashRouter(routes);
}
