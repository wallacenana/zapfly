const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const instancesCount = await prisma.instance.count();
  if (instancesCount === 0) {
    console.log('Populando banco de dados com instâncias iniciais...');
    await prisma.instance.create({
      data: {
        name: 'Suporte Vendas',
        status: 'disconnected'
      }
    });
    await prisma.instance.create({
      data: {
        name: 'Financeiro',
        status: 'disconnected'
      }
    });
    
    // Configurações globais
    await prisma.setting.upsert({
      where: { id: 'global' },
      update: {},
      create: { id: 'global', activeModel: 'openai' }
    });
    
    console.log('Seed concluído com sucesso!');
  } else {
    console.log('Banco de dados já contém dados. Pulando seed.');
  }
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
