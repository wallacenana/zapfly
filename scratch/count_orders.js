const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function countOrders() {
  const hoje = new Date().toISOString().split('T')[0];
  console.log('Data de hoje:', hoje);
  
  const ordersToday = await prisma.order.findMany({
    where: { 
      scheduledDate: hoje, 
      status: { notIn: ['cancelled', 'cancelado'] } 
    },
    include: { productRelation: true }
  });
  
  console.log(`Total de pedidos para hoje (não cancelados): ${ordersToday.length}`);
  console.table(ordersToday.map(o => ({
    id: o.id.slice(-5),
    product: o.product,
    status: o.status,
    type: o.type,
    time: o.scheduledTime
  })));
  
  const settings = await prisma.setting.findUnique({ where: { id: 'global' } });
  console.log('Configuração dailyMaxOrders:', settings?.dailyMaxOrders || 10);
  
  process.exit(0);
}

countOrders();
