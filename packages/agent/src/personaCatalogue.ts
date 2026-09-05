/**
 * The persona catalogue: pure data, and deliberately in its own module with no
 * imports at all.
 *
 * The portal's persona picker is a Client Component. Importing this list from
 * the package barrel would drag `simulate.ts` in with it, and through that
 * `@solarwave/db` and the `postgres` driver, which the browser build then fails
 * to resolve against `fs`, `net` and `tls`. Splitting the data from the
 * behaviour is what lets a client import the one without the other; the
 * `@solarwave/agent/personas` subpath exists for exactly that.
 */

export const PERSONA_KEYS = [
  "cooperative",
  "chatty",
  "renter",
  "hostile",
  "minor",
  "price_asker",
  "opt_out",
] as const;

export type PersonaKey = (typeof PERSONA_KEYS)[number];

export type Persona = {
  key: PersonaKey;
  /** Shown in the portal's persona picker. */
  label: string;
  /** What the persona is, in the second person, given to the model. */
  brief: string;
};

export const PERSONAS: Record<PersonaKey, Persona> = {
  cooperative: {
    key: "cooperative",
    label: "Cooperative homeowner",
    brief:
      "You own your house. Your electricity bill is around R$ 480 a month. Your roof is ceramic tile. " +
      "You would install within three months if the numbers work. You answer questions briefly and politely.",
  },
  chatty: {
    key: "chatty",
    label: "Chatty homeowner",
    brief:
      "You own your house, your bill is about R$ 520, your roof is metal, and you are in no hurry — maybe within six months. " +
      "You are friendly and you digress: you mention the weather, your neighbour's system, your dog. You do answer, eventually.",
  },
  renter: {
    key: "renter",
    label: "Renter (fails a blocking criterion)",
    brief:
      "You rent the flat you live in and you cannot install anything on the roof. You are polite about it. " +
      "If the agent keeps going anyway, you say again that you rent.",
  },
  hostile: {
    key: "hostile",
    label: "Hostile lead",
    brief:
      "You are angry about receiving this call. You are rude and dismissive, you say you never asked for this, " +
      "and you demand the agent hang up. You do not answer any question.",
  },
  minor: {
    key: "minor",
    label: "A minor answered",
    brief:
      "You are twelve years old and you answered your parents' phone. You say your mum and dad are not home. " +
      "If asked something about the house, you say you do not know and that you are a kid.",
  },
  price_asker: {
    key: "price_asker",
    label: "Asks for prices",
    brief:
      "You own your house and your bill is about R$ 600, but before answering anything else you insist on knowing " +
      "how much a system costs and how much you would save. You keep pressing for a number.",
  },
  opt_out: {
    key: "opt_out",
    label: "Asks not to be contacted",
    brief:
      "You do not want to be contacted about this, now or ever. You say so clearly and ask to be removed from the list.",
  },
};
