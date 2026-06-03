// ─────────────────────────────────────────────────────────────
//  Seed script — generates correct bcrypt hash for default admin
//  Run: node scripts/seed-admin.js
//  Then update migration.sql INSERT with the printed hash
// ─────────────────────────────────────────────────────────────
require('dotenv').config();
const bcrypt = require('bcryptjs');

async function main() {
  const password = 'Admin@1234';
  const hash     = await bcrypt.hash(password, 12);

  console.log('\n── Default Admin Credentials ──────────────────');
  console.log('Username :', 'admin');
  console.log('Password :', password);
  console.log('Hash     :', hash);
  console.log('\nRun this SQL in Supabase to update the admin password:');
  console.log(`\nUPDATE users SET "passwordHash" = '${hash}' WHERE username = 'admin';\n`);
}

main();
