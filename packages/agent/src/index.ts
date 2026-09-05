export {
  callOrder,
  questionFor,
  vocabularyFor,
  type CallLanguage,
  type ScriptCriterion,
} from "./criteria";
export { framePrologue, frameEpilogue, GUARDRAIL_RULES } from "./frame";
export { buildCallScript, type BuildCallScriptInput, type CallScript } from "./script";
export {
  TOOL_NAMES,
  TOOL_REGISTRY,
  END_CALL_REASONS,
  toAiSdkTools,
  toFunctionDeclarations,
  type EndCallReason,
  type FunctionDeclaration,
  type ToolDefinition,
  type ToolName,
} from "./tools";
export {
  CallState,
  outcomeFor,
  readAnswer,
  readCallbackTime,
  readReason,
  type CallStateInput,
  type LiveAnswer,
  type ToolInvocation,
} from "./callState";
export {
  runConversation,
  type ConversationError,
  type ConversationResult,
  type Responder,
  type RunConversationInput,
} from "./loop";
export {
  lintQuestions,
  LINT_CONCERNS,
  LINT_FIELDS,
  type LintConcern,
  type LintField,
  type LintInput,
  type LintWarning,
} from "./linter";
export {
  PERSONAS,
  PERSONA_KEYS,
  llmResponder,
  scriptedResponder,
  type LlmResponderInput,
  type Persona,
  type PersonaKey,
  type ScriptedPersona,
  type ScriptedPersonaInput,
  type ScriptedRule,
} from "./personas";
/**
 * `simulateCall` is NOT exported here, on purpose.
 *
 * It is the one module in this package that touches `@solarwave/db`, and
 * through it the postgres driver. Re-exporting it from the barrel means every
 * Client Component that imports anything from `@solarwave/agent` drags the
 * driver into the browser bundle, where `fs`, `net` and `tls` do not resolve
 * and the build fails — which is exactly what happened the first time this
 * package was deployed.
 *
 * Keeping it behind `@solarwave/agent/simulate` makes the barrel safe by
 * construction rather than by everyone remembering. Client-safe subpaths:
 * `@solarwave/agent/criteria` (pure ordering) and `@solarwave/agent/personas`
 * (the catalogue, no imports at all).
 */
