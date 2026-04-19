const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Limpando conversas...');
  const msgCount = await prisma.message.deleteMany({});
  const chatCount = await prisma.chat.deleteMany({});
  console.log(`Sucesso! Removidas ${msgCount.count} mensagens e ${chatCount.count} conversas.`);
}

main()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());
