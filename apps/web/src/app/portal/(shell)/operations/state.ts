/**
 * Shared shape for the operations Server Action.
 *
 * This lives outside `actions.ts` for the same reason `criteria/state.ts` does:
 * a `"use server"` module may only export async functions. Exporting a plain
 * object from one turns it into a server reference the client can never
 * resolve, so `useActionState` receives `undefined` as its initial state and
 * the first render throws on `state.fieldErrors`.
 *
 * Found by photographing the page: the build compiles, every test passes, and
 * the screen renders "This page couldn't load".
 */
export type OperationsState = {
  ok: boolean;
  message: string | null;
  fieldErrors: Record<string, string>;
  /** Changes on every submission so the client can react to repeated outcomes. */
  nonce: number;
};

export const initialOperationsState: OperationsState = {
  ok: true,
  message: null,
  fieldErrors: {},
  nonce: 0,
};
