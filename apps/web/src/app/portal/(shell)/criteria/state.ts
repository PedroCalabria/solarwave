import type { LintWarning } from "@solarwave/agent";

/**
 * Shared shape for the criteria Server Actions.
 *
 * This lives outside `actions.ts` on purpose: a `"use server"` module may only
 * export async functions. Exporting a plain object from it turns into a server
 * reference the client can never resolve, which leaves the RSC stream open and
 * the page hanging until the browser gives up.
 */
export type ActionState = {
  ok: boolean;
  message: string | null;
  fieldErrors: Record<string, string>;
  /**
   * Advice about a criterion that WAS saved, distinct from `fieldErrors`, which
   * reject a save. A warning never changes whether the write happened, and the
   * save path never waits on a model to produce one (design D10).
   */
  warnings: LintWarning[];
  /** Changes on every submission so the client can react to repeated outcomes. */
  nonce: number;
};

export const initialActionState: ActionState = {
  ok: false,
  message: null,
  fieldErrors: {},
  warnings: [],
  nonce: 0,
};
