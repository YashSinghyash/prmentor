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

// Microsoft Learn search phrases per concept. Used by the dashboard, because
// the model's own learnQuery is not stored in the database.
const LEARN_TERMS = {
  "sql-injection": "SQL injection",
  "command-injection": "command injection",
  xss: "cross-site scripting XSS",
  "hardcoded-secret": "hard-coded secrets key vault",
  "null-check": "null reference check",
  "input-validation": "input validation",
  "error-handling": "exception handling best practices",
  "off-by-one": "off-by-one error loops arrays",
  "resource-leak": "dispose resources leak",
  "race-condition": "race condition thread safety",
  "auth-check": "authorization checks",
  other: "secure coding best practices",
};

/** Link to the Microsoft Learn search page for a concept. */
export function learnUrl(concept) {
  const terms = LEARN_TERMS[concept] || concept.replace(/-/g, " ");
  return `https://learn.microsoft.com/en-us/search/?terms=${encodeURIComponent(terms)}`;
}
