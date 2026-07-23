/**
 * Usage: node scripts/hash-password.js "theirPassword"
 * Copy the output into data/users.json or data/admins.json as "passwordHash".
 */
const { hashPassword } = require('../lib/store');

const plain = process.argv[2];
if (!plain) {
  console.error('Usage: node scripts/hash-password.js "somePassword"');
  process.exit(1);
}

console.log(hashPassword(plain));
