// ─────────────────────────────────────────────────────────────
//  Prisma client — singleton per region
//  Usage:
//    const { getDb } = require('./lib/prisma');
//    const db = getDb(req.region); // 'us' or 'asia'
// ─────────────────────────────────────────────────────────────
const { PrismaClient } = require('@prisma/client');

let clientUS = null;
let clientAsia = null;

function getDb(region = 'us') {
  if (region === 'asia') {
    if (!clientAsia) {
      clientAsia = new PrismaClient({
        datasources: { db: { url: process.env.DATABASE_URL_ASIA } },
      });
    }
    return clientAsia;
  }
  // default: US
  if (!clientUS) {
    clientUS = new PrismaClient({
      datasources: { db: { url: process.env.DATABASE_URL_US } },
    });
  }
  return clientUS;
}

module.exports = { getDb };
