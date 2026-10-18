/**
 * RTK Query over the typed client. `fakeBaseQuery<ApiErrorShape>()`: every endpoint runs a
 * `queryFn` against the active engine and returns data or a plain ApiErrorShape (serialisable,
 * shown by ErrorPanel). Health, versions, labels; the recent bags; a candidate set (the grid);
 * History (the list the engine reconciles on every call, delete, stats, backup, rebuild); the
 * comparisons (D12: list, view, create, cover and language, delete — their staleness is computed by
 * the engine on every call, so they are always asked again when a screen mounts). The open
 * session is not here: it lives in the session slice with its autosave. A new engine connection
 * resets the whole API state (store/engineBridge.ts), so nothing fetched from a previous engine
 * survives a restart.
 */
import { createApi, fakeBaseQuery } from "@reduxjs/toolkit/query/react";
import type { operations } from "@shared/api";
import { activeEngine, ENGINE_NOT_CONNECTED } from "./connection";
import { settle, type EngineClient, type Settled } from "./client";
import { appError, type ApiErrorShape } from "./errors";
import { LabelsInvalid, parseLabels, type EngineLabels } from "./labels";
import type {
  BackupOut,
  CandidateSet,
  ComparisonCreateIn,
  ComparisonInputsIn,
  ComparisonList,
  ComparisonView,
  DeleteOut,
  Health,
  HistoryList,
  HistoryStats,
  RecentBagList,
} from "./types";

/** /versions: the library-version stamp (string values; null where an app field is not set). */
export type Versions = Record<string, string | number | boolean | null>;

type QueryResult<T> = { data: T } | { error: ApiErrorShape };
export type SessionListQuery = NonNullable<operations["list_sessions"]["parameters"]["query"]>;
export type ComparisonListQuery = NonNullable<
  operations["list_comparisons"]["parameters"]["query"]
>;

async function run<T>(
  call: (client: EngineClient) => Promise<Settled<T>>,
): Promise<QueryResult<T>> {
  const engine = activeEngine();
  if (engine === null) return { error: ENGINE_NOT_CONNECTED };
  const result = await call(engine.client);
  return "error" in result ? { error: result.error } : { data: result.data };
}

/** The typed client's answer as the schema type (openapi-fetch widens tuples in responses). */
async function runAs<T>(
  call: (client: EngineClient) => Promise<Settled<unknown>>,
): Promise<QueryResult<T>> {
  return (await run(call)) as QueryResult<T>;
}

function parseVersions(raw: unknown): Versions {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new TypeError("versions: not an object");
  }
  const out: Versions = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
      out[key] = value as string | number | boolean | null;
    }
  }
  return out;
}

export const engineApi = createApi({
  reducerPath: "engineApi",
  baseQuery: fakeBaseQuery<ApiErrorShape>(),
  tagTypes: ["Health", "Versions", "Labels", "RecentBags", "Candidates", "History", "Comparisons"],
  endpoints: (build) => ({
    getHealth: build.query<Health, void>({
      queryFn: () => run((client) => settle(() => client.GET("/health"))),
      providesTags: ["Health"],
    }),
    getVersions: build.query<Versions, void>({
      queryFn: async () => {
        const result = await run((client) => settle(() => client.GET("/versions")));
        if ("error" in result) return result;
        try {
          return { data: parseVersions(result.data) };
        } catch (error) {
          return { error: appError("invalid_response", String(error)) };
        }
      },
      providesTags: ["Versions"],
    }),
    getLabels: build.query<EngineLabels, void>({
      queryFn: async () => {
        const result = await run((client) => settle(() => client.GET("/meta/labels")));
        if ("error" in result) return result;
        try {
          return { data: parseLabels(result.data) };
        } catch (error) {
          const message = error instanceof LabelsInvalid ? error.message : String(error);
          return { error: appError("invalid_response", message) };
        }
      },
      providesTags: ["Labels"],
    }),

    listRecentBags: build.query<RecentBagList, void>({
      queryFn: () => runAs<RecentBagList>((client) => settle(() => client.GET("/bags/recent"))),
      providesTags: ["RecentBags"],
    }),
    addRecentBag: build.mutation<RecentBagList, string>({
      queryFn: (path) =>
        runAs<RecentBagList>((client) =>
          settle(() => client.POST("/bags/recent", { body: { path } })),
        ),
      invalidatesTags: ["RecentBags"],
    }),
    removeRecentBag: build.mutation<RecentBagList, string>({
      queryFn: (path) =>
        runAs<RecentBagList>((client) =>
          settle(() => client.DELETE("/bags/recent", { params: { query: { path } } })),
        ),
      invalidatesTags: ["RecentBags"],
    }),

    getCandidates: build.query<CandidateSet, { fingerprint: string; paramsHash: string }>({
      queryFn: ({ fingerprint, paramsHash }) =>
        runAs<CandidateSet>((client) =>
          settle(() =>
            client.GET("/candidates/{fingerprint}/{params_hash}", {
              params: { path: { fingerprint, params_hash: paramsHash } },
            }),
          ),
        ),
      providesTags: ["Candidates"],
    }),

    listSessions: build.query<HistoryList, SessionListQuery>({
      queryFn: (query) =>
        runAs<HistoryList>((client) =>
          settle(() => client.GET("/sessions", { params: { query } })),
        ),
      providesTags: ["History"],
    }),
    deleteSession: build.mutation<DeleteOut, string>({
      queryFn: (id) =>
        runAs<DeleteOut>((client) =>
          settle(() =>
            client.DELETE("/sessions/{session_id}", { params: { path: { session_id: id } } }),
          ),
        ),
      invalidatesTags: ["History", "Comparisons"],
    }),
    historyStats: build.query<HistoryStats, void>({
      queryFn: () => runAs<HistoryStats>((client) => settle(() => client.GET("/history/stats"))),
      providesTags: ["History"],
    }),
    backupHistory: build.mutation<BackupOut, string | null>({
      queryFn: (path) =>
        runAs<BackupOut>((client) =>
          settle(() => client.POST("/history/backup", { body: path === null ? {} : { path } })),
        ),
    }),
    rebuildHistory: build.mutation<Record<string, unknown>, void>({
      queryFn: () =>
        runAs<Record<string, unknown>>((client) => settle(() => client.POST("/history/rebuild"))),
      invalidatesTags: ["History", "Comparisons"],
    }),

    listComparisons: build.query<ComparisonList, ComparisonListQuery>({
      queryFn: (query) =>
        runAs<ComparisonList>((client) =>
          settle(() => client.GET("/comparisons", { params: { query } })),
        ),
      providesTags: ["Comparisons"],
    }),
    getComparison: build.query<ComparisonView, string>({
      queryFn: (id) =>
        runAs<ComparisonView>((client) =>
          settle(() =>
            client.GET("/comparisons/{comparison_id}", {
              params: { path: { comparison_id: id } },
            }),
          ),
        ),
      providesTags: ["Comparisons"],
    }),
    createComparison: build.mutation<ComparisonView, ComparisonCreateIn>({
      queryFn: (body) =>
        runAs<ComparisonView>((client) => settle(() => client.POST("/comparisons", { body }))),
      invalidatesTags: ["Comparisons", "History"],
    }),
    patchComparisonInputs: build.mutation<ComparisonView, { id: string; body: ComparisonInputsIn }>(
      {
        queryFn: ({ id, body }) =>
          runAs<ComparisonView>((client) =>
            settle(() =>
              client.PATCH("/comparisons/{comparison_id}/inputs", {
                params: { path: { comparison_id: id } },
                body,
              }),
            ),
          ),
        invalidatesTags: ["Comparisons"],
      },
    ),
    deleteComparison: build.mutation<DeleteOut, string>({
      queryFn: (id) =>
        runAs<DeleteOut>((client) =>
          settle(() =>
            client.DELETE("/comparisons/{comparison_id}", {
              params: { path: { comparison_id: id } },
            }),
          ),
        ),
      invalidatesTags: ["Comparisons", "History"],
    }),
  }),
});

export const {
  useGetHealthQuery,
  useGetVersionsQuery,
  useGetLabelsQuery,
  useListRecentBagsQuery,
  useAddRecentBagMutation,
  useRemoveRecentBagMutation,
  useGetCandidatesQuery,
  useListSessionsQuery,
  useDeleteSessionMutation,
  useHistoryStatsQuery,
  useBackupHistoryMutation,
  useRebuildHistoryMutation,
  useListComparisonsQuery,
  useGetComparisonQuery,
  useCreateComparisonMutation,
  usePatchComparisonInputsMutation,
  useDeleteComparisonMutation,
} = engineApi;
