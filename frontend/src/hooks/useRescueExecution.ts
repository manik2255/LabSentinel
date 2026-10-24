/**
 * Executes a rescue plan by issuing real PATCH /api/samples/{id} moves, one per
 * allocation, against the demo backend. Each move is re-validated by the
 * backend; a rejection (409/422) or network failure is reported with the
 * backend's detail and never counted as a success.
 *
 * Guards:
 *  - demo scope: plans that touch equipment or samples outside the demo lab
 *    are refused here, independently of any disabled button;
 *  - duplicate submission: a ref blocks a second concurrent execution.
 */
import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import * as api from "../api/endpoints";
import { ApiError } from "../api/client";
import type { RescuePlan } from "../domain/rescue";
import { checkPlanScope } from "../domain/demoScope";
import { queryKeys } from "./queries";

export interface MoveResult {
  sampleId: number;
  sampleName: string;
  destinationName: string;
  ok: boolean;
  detail?: string;
}

export interface ExecutionResult {
  moves: MoveResult[];
  movedCount: number;
  allSucceeded: boolean;
  /** Set when execution was refused before any request was sent. */
  blockedReason?: string;
}

export function useRescueExecution() {
  const qc = useQueryClient();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ExecutionResult | null>(null);
  const inflight = useRef(false);

  const execute = useCallback(
    async (plan: RescuePlan): Promise<ExecutionResult | null> => {
      if (inflight.current) return null;

      const scope = checkPlanScope(plan);
      if (!scope.executable) {
        const blocked: ExecutionResult = {
          moves: [],
          movedCount: 0,
          allSucceeded: false,
          blockedReason: scope.reason ?? "Execution is outside the demo scope.",
        };
        setResult(blocked);
        return blocked;
      }

      inflight.current = true;
      setRunning(true);
      const moves: MoveResult[] = [];
      try {
        for (const alloc of plan.allocations) {
          try {
            await api.updateSample(alloc.sample.id, {
              equipment_id: alloc.destination.id,
            });
            moves.push({
              sampleId: alloc.sample.id,
              sampleName: alloc.sample.name,
              destinationName: alloc.destination.name,
              ok: true,
            });
          } catch (err) {
            moves.push({
              sampleId: alloc.sample.id,
              sampleName: alloc.sample.name,
              destinationName: alloc.destination.name,
              ok: false,
              detail:
                err instanceof ApiError
                  ? err.detail
                  : err instanceof Error
                    ? err.message
                    : "Move failed.",
            });
          }
        }
        const movedCount = moves.filter((m) => m.ok).length;
        const res: ExecutionResult = {
          moves,
          movedCount,
          allSucceeded: moves.length > 0 && movedCount === moves.length,
        };
        setResult(res);
        return res;
      } finally {
        inflight.current = false;
        setRunning(false);
        void qc.invalidateQueries({ queryKey: queryKeys.equipment });
        void qc.invalidateQueries({ queryKey: ["samples"] });
      }
    },
    [qc],
  );

  return { execute, running, result };
}
