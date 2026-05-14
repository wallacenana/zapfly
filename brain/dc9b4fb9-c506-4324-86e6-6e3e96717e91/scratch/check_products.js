const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findUnique({
    where: { slug: 'linda-cake' },
    include: { products: true }
  });
  
  if (!user) {
    console.log('Usuário não encontrado');
    return;
  }
  
  console.log('Total de produtos:', user.products.length);
  user.products.forEach(p => {
    console.log(`- [${p.id}] Name: ${p.name}, Category: ${p.category}`);
  });
}

main().finally(() => prisma.$disconnect());
