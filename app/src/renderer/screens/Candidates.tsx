/**
 * The frame search (#/candidates): the engine walks the bag as a background job (C2.8) — one at a
 * time, engine-wide; a job already running is followed instead of refused. Progress arrives over
 * SSE (polling when the stream fails); Stop keeps the frames found so far, Cancel discards. When
 * the job yields a candidate set, the grid opens.
 */
import { Images, RotateCcw, Search } from "lucide-react";
import { useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router";
import { ErrorPanel } from "@/components/domain/ErrorPanel";
import { JobProgress } from "@/components/domain/JobProgress";
import { Bi } from "@/components/ui/Bi";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { PathText } from "@/components/ui/Ltr";
import { Spinner } from "@/components/ui/Spinner";
import { messagePair } from "@/i18n/t";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  candidateJobCancelRequested,
  candidateJobRequested,
  candidateJobStopRequested,
} from "@/store/listeners/candidates";
import type { CandidateSetRef } from "@/store/slices/candidates";

export function setPath(set: Pick<CandidateSetRef, "fingerprint" | "paramsHash">): string {
  return `/candidates/${set.fingerprint}/${set.paramsHash}`;
}

export function Candidates() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { bagPath, start, job, set } = useAppSelector((state) => state.candidates);
  // a set that arrives while this screen is open opens the grid; one found earlier waits for a click
  const setOnArrival = useRef(set);
  useEffect(() => {
    if (set !== null && set !== setOnArrival.current)
      void navigate(setPath(set), { replace: true });
  }, [set, navigate]);

  const again = (force: boolean) => {
    if (bagPath !== null) dispatch(candidateJobRequested({ bagPath, force }));
  };

  if (bagPath === null) {
    return (
      <div className="flex flex-1 items-start justify-center p-8">
        <EmptyState
          icon={Search}
          title={messagePair("job.none")}
          description={messagePair("job.noneHint")}
          className="w-full max-w-lg"
          action={
            <Button variant="primary" asChild>
              <Link to="/">
                <Bi {...messagePair("nav.home")} />
              </Link>
            </Button>
          }
        />
      </div>
    );
  }

  const terminal = job?.snapshot.terminal ?? false;
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">
          <Bi {...messagePair("job.screenTitle")} />
        </h1>
        <PathText path={bagPath} className="text-sm text-ink-secondary" />
      </div>
      {start.state === "starting" ? (
        <p className="flex items-center gap-2 text-sm text-ink-secondary" role="status">
          <Spinner size="sm" />
          <Bi {...messagePair("job.starting")} />
        </p>
      ) : null}
      {start.state === "error" && start.error ? (
        <ErrorPanel
          error={start.error}
          context={messagePair("job.startFailed")}
          onRetry={() => again(false)}
        />
      ) : null}
      {job !== null ? (
        <JobProgress
          job={job.snapshot}
          transport={job.transport}
          onStop={() => dispatch(candidateJobStopRequested())}
          onCancel={() => dispatch(candidateJobCancelRequested())}
          actions={
            set !== null ? (
              <Button variant="primary" onClick={() => void navigate(setPath(set))}>
                <Images aria-hidden="true" />
                <Bi {...messagePair("job.showFrames")} />
              </Button>
            ) : terminal ? (
              <Button onClick={() => again(false)}>
                <RotateCcw aria-hidden="true" />
                <Bi {...messagePair("job.again")} />
              </Button>
            ) : null
          }
        />
      ) : null}
      {job === null && set !== null ? (
        <div>
          <Button variant="primary" onClick={() => void navigate(setPath(set))}>
            <Images aria-hidden="true" />
            <Bi {...messagePair("job.showFrames")} />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
