const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkSlots() {
  const slots = await prisma.availableSlot.findMany();
  console.log('--- SLOTS DE DISPONIBILIDADE ---');
  console.table(slots);
  
  const hoje = new Date();
  const diaSemana = hoje.getDay();
  console.log('Hoje (dia da semana):', diaSemana);
  
  const slotsHoje = await prisma.availableSlot.findMany({ where: { dayOfWeek: diaSemana } });
  console.log('Slots para hoje:');
  console.table(slotsHoje);
  
  process.exit(0);
}

checkSlots();
