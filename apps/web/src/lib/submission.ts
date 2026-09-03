import type { Locale } from "./i18n";

/**
 * What the confirmation screen needs to echo back. Held in sessionStorage
 * between the form POST and the redirect; once `packages/db` exists the
 * confirmation page should read the created lead by id instead.
 */
export type Submission = {
  name: string;
  phone: string;
  email: string;
  callLang: Locale;
};

export const SUBMISSION_KEY = "solarwave:submission";
