// ─────────────────────────────────────────────────────────────
//  Prisma client — singleton per region
//  Prisma v6+: URL passed via datasourceUrl constructor option
// ─────────────────────────────────────────────────────────────
const { PrismaClient } = require('@prisma/client');

let clientUS   = null;
let clientAsia = null;

function getDb(region = 'us') {
  if (region === 'asia') {
    if (!clientAsia) {
      clientAsia = new PrismaClient({
        datasourceUrl: process.env.DATABASE_URL_ASIA,
      });
    }
    return clientAsia;
  }
  if (!clientUS) {
    clientUS = new PrismaClient({
      datasourceUrl: process.env.DATABASE_URL_US,
    });
  }
  return clientUS;
}

module.exports = { getDb };
