import { describe, expect, it } from "vitest";
import { TOOL_NAMES, TOOL_REGISTRY, toAiSdkTools, toFunctionDeclarations } from "./tools";

const KEYS = ["homeowner", "monthly_bill", "roof_type"];

/** Reads the parameter names out of a JSON Schema object. */
const propsOf = (schema: Record<string, unknown>): string[] =>
  Object.keys((schema.properties ?? {}) as Record<string, unknown>).sort();

describe("the tool registry", () => {
  it("declares exactly the five tools of the contract", () => {
    expect(TOOL_REGISTRY.map((t) => t.name)).toEqual([...TOOL_NAMES]);
    expect(TOOL_REGISTRY).toHaveLength(5);
  });

  it("constrains record_answer to the criteria of this call", () => {
    const declarations = toFunctionDeclarations(KEYS);
    const record = declarations.find((d) => d.name === "record_answer")!;
    const properties = record.parameters.properties as Record<string, { enum?: string[] }>;

    expect(properties.criterion_key?.enum).toEqual(KEYS);
  });

  it("falls back to a free string when a call has no criteria", () => {
    const record = toFunctionDeclarations([]).find((d) => d.name === "record_answer")!;
    const properties = record.parameters.properties as Record<string, { enum?: string[]; type?: string }>;

    expect(properties.criterion_key?.enum).toBeUndefined();
    expect(properties.criterion_key?.type).toBe("string");
  });
});

describe("the two projections", () => {
  it("expose the same tool names", () => {
    const sdk = Object.keys(toAiSdkTools(KEYS)).sort();
    const gemini = toFunctionDeclarations(KEYS)
      .map((d) => d.name)
      .sort();

    expect(sdk).toEqual(gemini);
  });

  it("expose the same parameters for every tool", () => {
    // This is the whole point of one registry: a parameter added in one place
    // reaches both, so the text path and the voice path cannot diverge.
    const sdk = toAiSdkTools(KEYS);
    for (const declaration of toFunctionDeclarations(KEYS)) {
      const definition = TOOL_REGISTRY.find((t) => t.name === declaration.name)!;
      const fromRegistry = Object.keys(definition.parameters(KEYS).shape).sort();

      expect(propsOf(declaration.parameters)).toEqual(fromRegistry);
      expect(sdk[declaration.name]).toBeDefined();
    }
  });

  it("carry the same descriptions", () => {
    const sdk = toAiSdkTools(KEYS);
    for (const declaration of toFunctionDeclarations(KEYS)) {
      expect(sdk[declaration.name]?.description).toBe(declaration.description);
    }
  });

  it("adding a parameter to the registry reaches both without a separate edit", () => {
    const definition = TOOL_REGISTRY.find((t) => t.name === "record_answer")!;
    const registryParams = Object.keys(definition.parameters(KEYS).shape).sort();
    const geminiParams = propsOf(toFunctionDeclarations(KEYS).find((d) => d.name === "record_answer")!.parameters);

    expect(geminiParams).toEqual(registryParams);
    expect(registryParams).toEqual(["criterion_key", "value"]);
  });
});

describe("the Gemini projection", () => {
  it("is plain serialisable JSON", () => {
    const declarations = toFunctionDeclarations(KEYS);

    expect(() => JSON.stringify(declarations)).not.toThrow();
    expect(JSON.parse(JSON.stringify(declarations))).toEqual(declarations);
  });

  it("gives the no-argument tools an empty object schema, not a missing one", () => {
    for (const name of ["mark_opt_out", "flag_minor"]) {
      const declaration = toFunctionDeclarations(KEYS).find((d) => d.name === name)!;

      expect(declaration.parameters.type).toBe("object");
      expect(propsOf(declaration.parameters)).toEqual([]);
    }
  });

  it("constrains end_call to the known reasons", () => {
    const declaration = toFunctionDeclarations(KEYS).find((d) => d.name === "end_call")!;
    const properties = declaration.parameters.properties as Record<string, { enum?: string[] }>;

    expect(properties.reason?.enum).toContain("opt_out");
    expect(properties.reason?.enum).toContain("hostile");
    expect(properties.reason?.enum).toContain("enough_information");
  });
});
