'use strict';
// Creates an administrator from the command line.
// Usage: npm run create-admin -- "Full Name" email@example.com
// You will be asked for a password (it is not shown or stored in your shell history).
const readline = require('readline');
const db = require('../server/db');
const { hashPassword, passwordProblem } = require('../server/security');

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(s); };
    rl.question(question, (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer); });
  });
}

(async () => {
  const [name, email] = process.argv.slice(2);
  if (!name || !email || !email.includes('@')) {
    console.error('Usage: npm run create-admin -- "Full Name" email@example.com');
    process.exit(1);
  }
  const password = process.env.ADMIN_PASSWORD || await askHidden('Password (at least 10 characters): ');
  const problem = passwordProblem(password);
  if (problem) { console.error(problem); process.exit(1); }
  await db.migrate();
  await db.withContext({ role: 'system' }, (c) => c.query(
    'INSERT INTO admin_users (email, name, password_hash) VALUES ($1,$2,$3)', [email.trim().toLowerCase(), name, hashPassword(password)]));
  console.log(`Administrator ${email} created. Sign in at /admin`);
  await db.pool.end();
})().catch((err) => { console.error(err.message); process.exit(1); });
