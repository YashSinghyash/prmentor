// Sample file for testing PRMentor: copy it into your test repo on a new branch and open a PR.
// It contains deliberate bugs.

const db = require("./db");

// BUG 1: SQL built by string concatenation (SQL injection)
function findUserByName(name) {
  const query = "SELECT * FROM users WHERE name = '" + name + "'";
  return db.query(query);
}

// BUG 2: findUser() can return null, but we read .email without checking
async function getEmail(id) {
  const user = await db.findUser(id);
  return user.email.toLowerCase();
}

// BUG 3: hard-coded secret
const API_KEY = "sk_live_51H8exampleSecretKey";

module.exports = { findUserByName, getEmail, API_KEY };
