const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const bcrypt = require('bcryptjs');

async function main() {
  const hash = await bcrypt.hash('admin123', 10);
  let admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
  
  if (!admin) {
    admin = await prisma.user.create({
      data: {
        name: 'Wallace',
        email: 'admin@zapfly.com',
        password: hash,
        role: 'ADMIN',
        active: true
      }
    });
    console.log('Created admin user:', admin.email);
  }

  // Update existing records
  const updatePromises = [
    prisma.instance.updateMany({ where: { userId: null }, data: { userId: admin.id } }),
    prisma.product.updateMany({ where: { userId: null }, data: { userId: admin.id } }),
    prisma.category.updateMany({ where: { userId: null }, data: { userId: admin.id } }),
    prisma.order.updateMany({ where: { userId: null }, data: { userId: admin.id } }),
    prisma.customer.updateMany({ where: { userId: null }, data: { userId: admin.id } }),
    prisma.stockItem.updateMany({ where: { userId: null }, data: { userId: admin.id } }),
    prisma.availableSlot.updateMany({ where: { userId: null }, data: { userId: admin.id } }),
    prisma.calendarEvent.updateMany({ where: { userId: null }, data: { userId: admin.id } }),
    prisma.marketingAsset.updateMany({ where: { userId: null }, data: { userId: admin.id } }),
    prisma.seasonalCatalog.updateMany({ where: { userId: null }, data: { userId: admin.id } }),
    prisma.setting.updateMany({ where: { userId: null }, data: { userId: admin.id } })
  ];

  await Promise.all(updatePromises);
  console.log('Migrated all orphan records to admin user');
}

main().catch(console.error).finally(() => prisma.$disconnect());
