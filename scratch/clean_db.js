const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function clean() {
  console.log('Iniciando limpeza de duplicatas...');
  const messages = await prisma.message.findMany();
  const seen = new Set();
  const toDelete = [];

  for (const msg of messages) {
    if (seen.has(msg.msgId)) {
      toDelete.push(msg.id);
    } else {
      seen.add(msg.msgId);
    }
  }

  if (toDelete.length > 0) {
    await prisma.message.deleteMany({
      where: { id: { in: toDelete } }
    });
    console.log(`Removidas ${toDelete.length} mensagens duplicadas.`);
  } else {
    console.log('Nenhuma duplicata encontrada.');
  }
}

clean().catch(console.error).finally(() => prisma.$disconnect());
