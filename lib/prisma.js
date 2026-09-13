const { PrismaClient } = require('@prisma/client');
const globalForPrisma = globalThis;

const prisma = globalForPrisma.__menzzuPrisma || new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__menzzuPrisma = prisma;
}

module.exports = prisma;
