"use client";

import { useSyncExternalStore } from "react";
import { SUBMISSION_KEY, type Submission } from "./submission";

/**
 * sessionStorage is an external store, so it is read through
 * useSyncExternalStore rather than an effect. getSnapshot must be referentially
 * stable between reads or React re-renders forever, hence the parse cache.
 */
let cachedRaw: string | null = null;
let cachedValue: Submission | null = null;

function getSnapshot(): Submission | null {
  let raw: string | null;
  try {
    raw = sessionStorage.getItem(SUBMISSION_KEY);
  } catch {
    return null;
  }
  if (raw === cachedRaw) return cachedValue;
  cachedRaw = raw;
  try {
    cachedValue = raw ? (JSON.parse(raw) as Submission) : null;
  } catch {
    cachedValue = null;
  }
  return cachedValue;
}

/** The value is written once before navigation and never mutated while mounted. */
function subscribe(): () => void {
  return () => {};
}

/** Null on the server and on first paint, so the markup hydrates consistently. */
export function useSubmission(): Submission | null {
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}
