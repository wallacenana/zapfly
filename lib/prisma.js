const { PrismaClient } = require('@prisma/client');
const globalForPrisma = globalThis;

const prisma = globalForPrisma.__hotwhatsPrisma || new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__hotwhatsPrisma = prisma;
}

module.exports = prisma;
