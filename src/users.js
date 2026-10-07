// DEMO PR A: replaces src/users.js on a branch (copy this over src/users.js).
// It changes what getUser() returns: an object instead of a string.

const USERS = {
  1: { name: "Ada", email: "ada@example.com" },
  2: { name: "Linus", email: "linus@example.com" },
};

// Returns the user as an object so callers can also read the email.
function getUser(id) {
  const user = USERS[id];
  if (!user) return null;
  return { name: user.name, email: user.email };
}

module.exports = { getUser };
