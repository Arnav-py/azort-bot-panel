/**
 * Usage: node scripts/set-password.js admins arnav "yourPassword"
 *        node scripts/set-password.js users clientName "yourPassword"
 */
const { readJSON, writeJSON, hashPassword } = require('../lib/store');

const [file, username, plainPassword] = process.argv.slice(2);
const allowedFiles = new Set(['admins', 'users']);

if (!allowedFiles.has(file) || !username || !plainPassword) {
  console.error('Usage: node scripts/set-password.js <admins|users> <username> "password"');
  process.exit(1);
}

if (plainPassword.length < 8) {
  console.error('Password must be at least 8 characters long.');
  process.exit(1);
}

async function main() {
  const filename = `${file}.json`;
  const records = await readJSON(filename) || [];
  const record = records.find(item => item.username.toLowerCase() === username.toLowerCase());

  if (!record) {
    console.error(`No ${file.slice(0, -1)} account found for username "${username}".`);
    process.exit(1);
  }

  record.passwordHash = hashPassword(plainPassword);
  await writeJSON(filename, records);
  console.log(`Password updated for ${record.username} in data/${filename}.`);
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
