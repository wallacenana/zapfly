const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkCalendar() {
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);

  const events = await prisma.calendarEvent.findMany({
    where: {
      startAt: { gte: startOfDay },
      endAt: { lte: endOfDay }
    }
  });

  console.log('--- EVENTOS DE CALENDÁRIO PARA HOJE ---');
  console.table(events.map(e => ({
    title: e.title,
    start: e.startAt,
    end: e.endAt,
    allDay: e.allDay
  })));

  process.exit(0);
}

checkCalendar();
