// BASELINE for the conflict demo. Commit this to main of your test repo as src/users.js
// (before opening the two demo PRs).

const USERS = {
  1: { name: "Ada", email: "ada@example.com" },
  2: { name: "Linus", email: "linus@example.com" },
};

// Returns the user's display name as a plain string.
function getUser(id) {
  const user = USERS[id];
  if (!user) return "";
  return user.name;
}

module.exports = { getUser };
