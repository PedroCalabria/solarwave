import { applyLeadTransition, type Db } from "@solarwave/db";
import { openTestDb } from "@solarwave/db/test";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createIntakeHandler } from "./handler";

const hasDb = Boolean(process.env.DATABASE_URL ?? process.env.POSTGRES_URL);

describe.skipIf(!hasDb)("POST /api/leads", () => {
  let db: Db;
  let truncate: () => Promise<void>;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, truncate, close } = await openTestDb());
  });
  afterAll(async () => {
    await close();
  });
  beforeEach(async () => {
    await truncate();
  });

  const handler = (verify: (token: string) => Promise<boolean> = async () => true) =>
    createIntakeHandler({ db, verifyTurnstile: (t) => verify(t), ipSalt: "test" });

  const post = (body: unknown, ip = "203.0.113.9") =>
    new Request("http://localhost/api/leads", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });

  const valid = {
    name: "Maria Oliveira",
    phone: "(11) 98842-1170",
    email: "maria@email.com",
    preferredCallLanguage: "pt",
    turnstileToken: "XXXX.DUMMY.TOKEN.XXXX",
  };

  it("creates a lead and returns 201 with its id", async () => {
    const res = await handler()(post(valid));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.status).toBe("created");
    expect(data.lead).toMatchObject({ phone: "+5511988421170", preferredCallLanguage: "pt", status: "new" });
    expect(typeof data.lead.id).toBe("string");
    expect(data.lead.nextCallAt).not.toBeNull();
  });

  it("returns 200 existing for a duplicate phone without changing the lead", async () => {
    const first = await (await handler()(post(valid))).json();
    const res = await handler()(post({ ...valid, name: "Other Name", phone: "+55 11 98842-1170" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("existing");
    expect(data.lead.id).toBe(first.lead.id);
    expect(data.lead.name).toBe("Maria Oliveira");
  });

  it("does not re-schedule an opted-out lead", async () => {
    const first = await (await handler()(post(valid))).json();
    await applyLeadTransition(db, first.lead.id, { type: "opt_out" });
    const res = await handler()(post(valid));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.lead.status).toBe("opt_out");
    expect(data.lead.nextCallAt).toBeNull();
  });

  it("rejects a missing CAPTCHA token with 400 before touching the database", async () => {
    const { turnstileToken: _omit, ...noToken } = valid;
    void _omit;
    const res = await handler(async () => {
      throw new Error("must not be called");
    })(post(noToken));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("captcha_missing");
  });

  it("rejects an invalid CAPTCHA token with 403", async () => {
    const res = await handler(async () => false)(post(valid));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("captcha_failed");
  });

  it("rate limits the sixth request from the same IP", async () => {
    const h = handler();
    for (let i = 0; i < 5; i++) {
      const res = await h(post({ ...valid, phone: `(11) 9884${i}-117${i}` }, "198.51.100.5"));
      expect([200, 201]).toContain(res.status);
    }
    const sixth = await h(post({ ...valid, phone: "(11) 98849-1179" }, "198.51.100.5"));
    expect(sixth.status).toBe(429);
    expect(sixth.headers.get("retry-after")).toBeTruthy();
  });

  it("falls back to pt for an unrecognised call language", async () => {
    const res = await handler()(post({ ...valid, preferredCallLanguage: "es" }));
    expect((await res.json()).lead.preferredCallLanguage).toBe("pt");
  });

  it("returns 422 field errors for invalid fields", async () => {
    const res = await handler()(post({ ...valid, name: "Jo", email: "nope" }));
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(Object.keys(data.fieldErrors).sort()).toEqual(["email", "name"]);
  });

  it("returns 422 with a phone error for a non-Brazilian number", async () => {
    const res = await handler()(post({ ...valid, phone: "+1 512 555 0148" }));
    expect(res.status).toBe(422);
    expect((await res.json()).fieldErrors.phone).toMatch(/Brazilian/);
  });

  it("returns 400 for malformed JSON", async () => {
    const res = await handler()(post("{not json"));
    expect(res.status).toBe(400);
  });
});
