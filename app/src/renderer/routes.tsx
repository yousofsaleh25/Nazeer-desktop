/** Hash routes (the app is served from app://nazeer/renderer/index.html). */
import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from "react";
import { createHashRouter, type RouteObject } from "react-router";
import { Home } from "./screens/Home";

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

export const routes: RouteObject[] = [{ path: "/", element: <Home /> }, ...devRoutes()];

export function createRouter() {
  return createHashRouter(routes);
}
