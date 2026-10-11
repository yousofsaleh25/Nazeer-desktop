import type { NazeerApi } from "@shared/ipc";

declare global {
  interface Window {
    nazeer: NazeerApi;
  }
}

export {};
