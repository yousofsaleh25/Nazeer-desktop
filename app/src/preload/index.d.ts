import type { NazeerApi, NazeerPrintApi } from "@shared/ipc";

declare global {
  interface Window {
    nazeer: NazeerApi;
    /** only in the hidden print window (preload/print.ts) */
    nazeerPrint?: NazeerPrintApi;
  }
}

export {};
