const { PrismaClient } = require('@prisma/client');
const globalForPrisma = globalThis;

const prisma = globalForPrisma.__digizapPrisma || new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__digizapPrisma = prisma;
}

module.exports = prisma;
