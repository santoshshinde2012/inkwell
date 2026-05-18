// The actions the user can trigger from the popover.
// Kept as a const-tuple + union so it works in both runtime (zod enum, switches)
// and compile-time (exhaustive checks).
//
//   reply     — draft a contextual response to a conversation
//   grammar   — fix grammar/spelling in the user's draft, in its own language
//   rewrite   — transform/compose/light-edit text (optionally into a new language)
//   translate — render a customer query (or any text) in a chosen language

export const ACTIONS = ["reply", "grammar", "rewrite", "translate"] as const;
export type Action = (typeof ACTIONS)[number];

export const isAction = (value: unknown): value is Action =>
  typeof value === "string" && (ACTIONS as readonly string[]).includes(value);
