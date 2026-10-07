// Cheap pre-filter for Phase 4. Before spending Groq quota on a pair of PRs,
// check whether they could possibly affect each other:
//   1. they touch the same file, or
//   2. one diff mentions a function/class name that the other diff defines.
// This is plain text matching (no parsing), so it is fast but approximate.

import { skipReason } from "./diff.js";

// Words that look like "name(...) {" but are language keywords, not functions.
const KEYWORDS = new Set([
  "if", "for", "while", "switch", "catch", "function", "return", "else", "do", "try", "with",
  "constructor", "async", "await", "new", "class", "const", "let", "var", "import", "export",
]);

// Names so generic that sharing them says nothing about a real dependency.
const GENERIC = new Set(["main", "init", "test", "run", "render", "setup", "handler", "callback", "index", "default", "describe"]);

// Patterns that capture the NAME of something being defined. One pattern per common style.
const DEFINITIONS = [
  /\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)/g, //                          function getUser(
  /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/g, // const getUser = (id) =>
  /\bclass\s+([A-Za-z_$][\w$]*)/g, //                                   class UserStore
  /\bdef\s+([A-Za-z_]\w*)/g, //                                         def get_user(   (Python)
  /\bfunc\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/g, //                       func GetUser(   (Go)
  /\b(?:public|private|protected|static)\s+[\w<>\[\],. ]+?\s+([A-Za-z_]\w*)\s*\(/g, // Java / C# methods
  /^\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/gm, //          getUser(id) {   (class method)
];

/** Returns the text of each diff line without the leading +/-/space marker. */
function patchLines(patch) {
  return patch.split("\n").map((line) => {
    // Hunk headers often end with the enclosing function: "@@ -1,5 +1,5 @@ function getUser(id) {"
    if (line.startsWith("@@")) return line.replace(/^@@[^@]*@@/, "");
    return line.slice(1);
  });
}

/** Names defined anywhere in a patch (added, removed or context lines). */
export function definedNames(patch) {
  const names = new Set();
  const text = patchLines(patch).join("\n");
  for (const re of DEFINITIONS) {
    for (const match of text.matchAll(re)) {
      const name = match[1];
      if (name && name.length >= 4 && !KEYWORDS.has(name) && !GENERIC.has(name)) names.add(name);
    }
  }
  return names;
}

/** Every identifier mentioned in a patch. */
function mentionedNames(patch) {
  return new Set(patchLines(patch).join("\n").match(/[A-Za-z_$][\w$]*/g) ?? []);
}

/** Only files that would actually be reviewed (same filter as Phase 1). */
function reviewable(files) {
  return files.filter((f) => !skipReason(f));
}

/**
 * Compares two PRs' file lists (as returned by pulls.listFiles).
 * Returns { sameFiles: [...], sharedNames: [...] }; both empty means "skip, no overlap".
 */
export function findOverlap(filesA, filesB) {
  const a = reviewable(filesA);
  const b = reviewable(filesB);

  // 1. Same file (a renamed file counts under its old name too).
  const namesOf = (files) => new Set(files.flatMap((f) => [f.filename, f.previous_filename].filter(Boolean)));
  const namesB = namesOf(b);
  const sameFiles = [...namesOf(a)].filter((n) => namesB.has(n));

  // 2. A name defined in one PR's diff that the other PR's diff mentions.
  const shared = new Set();
  const collect = (defs, others) => {
    for (const patch of others) {
      const mentioned = mentionedNames(patch);
      for (const name of defs) if (mentioned.has(name)) shared.add(name);
    }
  };
  const defsA = new Set(a.flatMap((f) => [...definedNames(f.patch)]));
  const defsB = new Set(b.flatMap((f) => [...definedNames(f.patch)]));
  collect(defsA, b.map((f) => f.patch));
  collect(defsB, a.map((f) => f.patch));

  return { sameFiles, sharedNames: [...shared].slice(0, 10) };
}
