/** What the print page found (its problems or warnings): each labelled, with its message and details. */
import type { PreflightProblem } from "@shared/ipc";
import { Bi } from "@/components/ui/Bi";
import { Ltr } from "@/components/ui/Ltr";
import { errorLabel } from "@/i18n/t";

export function ProblemList({ problems }: { problems: readonly PreflightProblem[] }) {
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {problems.map((problem, i) => {
        const label = errorLabel(problem.code);
        return (
          <li key={`${problem.code}-${i}`} data-code={problem.code} className="flex flex-col">
            <span className="font-medium">
              {label ? <Bi {...label} /> : <Ltr className="font-mono">{problem.code}</Ltr>}
            </span>
            <bdi dir="ltr" lang="en" className="text-xs text-ink-secondary">
              {problem.message}
            </bdi>
            {Object.keys(problem.details).length > 0 ? (
              <pre
                dir="ltr"
                className="mt-1 max-h-40 overflow-auto rounded-md border border-border bg-surface-raised p-2 font-mono text-[0.72rem] whitespace-pre-wrap"
              >
                {JSON.stringify(problem.details, null, 2)}
              </pre>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
