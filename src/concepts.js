// The fixed list of concept tags. The LLM must pick one of these, which keeps the
// tags consistent so the skill profile (Phase 3) can count them per student.

export const CONCEPTS = [
  "sql-injection",
  "command-injection",
  "xss",
  "hardcoded-secret",
  "null-check",
  "input-validation",
  "error-handling",
  "off-by-one",
  "resource-leak",
  "race-condition",
  "auth-check",
  "other",
];

/** Returns a valid concept tag; anything the model invents becomes "other". */
export function normalizeConcept(value) {
  const slug = String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, "-");
  return CONCEPTS.includes(slug) ? slug : "other";
}
