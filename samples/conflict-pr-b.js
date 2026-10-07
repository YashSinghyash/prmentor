// DEMO PR B: adds a NEW file, src/report.js, on another branch (copy this to src/report.js).
// It does not touch src/users.js, so Git merges it cleanly with PR A. But it still
// treats the result of getUser() as a plain string, which is what main returns today.

const { getUser } = require("./users");

function welcomeBanner(id) {
  const name = getUser(id);
  return "Welcome, " + name.toUpperCase() + "!";
}

module.exports = { welcomeBanner };
