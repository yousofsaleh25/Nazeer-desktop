/**
 * The print page (ADR-D7): rendered in a hidden window from the report model and the approved
 * overlay bytes, then printed with printToPDF. Built in Stage 7; this entry only mounts.
 */
import { createRoot } from "react-dom/client";

const root = document.getElementById("root");
if (root === null) throw new Error("#root is missing from print.html");

createRoot(root).render(null);
