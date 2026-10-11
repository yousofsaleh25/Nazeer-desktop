import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// vitest runs without globals, so Testing Library cannot register its own cleanup
afterEach(() => {
  cleanup();
});

// jsdom lacks what Radix primitives use for sizing and pointer handling (Chromium has them all)
class ResizeObserverStub implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver ??= ResizeObserverStub;

const elementStubs: Record<string, () => unknown> = {
  hasPointerCapture: () => false,
  setPointerCapture: () => undefined,
  releasePointerCapture: () => undefined,
  scrollIntoView: () => undefined,
};
for (const [name, stub] of Object.entries(elementStubs)) {
  if (!(name in Element.prototype)) {
    Object.defineProperty(Element.prototype, name, {
      value: stub,
      configurable: true,
      writable: true,
    });
  }
}
