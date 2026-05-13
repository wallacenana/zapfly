const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  // Admin: skip password change, force 2FA setup on next login
  const r = await prisma.user.updateMany({
    where: { role: 'ADMIN' },
    data: { mustChangePassword: false, twoFactorVerified: false }
  });
  console.log('Admin updated:', r);
}
main().then(() => prisma.$disconnect()).catch(console.error);
