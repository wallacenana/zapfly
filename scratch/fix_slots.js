const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function fixSlots() {
    console.log("Limpando horários antigos...");
    await prisma.availableSlot.deleteMany();
    
    const slots = [
        { dayOfWeek: 1, startTime: "09:00", endTime: "20:00", maxOrders: 10 }, // Segunda
        { dayOfWeek: 2, startTime: "09:00", endTime: "20:00", maxOrders: 10 }, // Terça
        { dayOfWeek: 3, startTime: "09:00", endTime: "20:00", maxOrders: 10 }, // Quarta
        { dayOfWeek: 4, startTime: "09:00", endTime: "20:00", maxOrders: 10 }, // Quinta
        { dayOfWeek: 5, startTime: "09:00", endTime: "20:00", maxOrders: 10 }, // Sexta
        { dayOfWeek: 6, startTime: "09:00", endTime: "20:00", maxOrders: 10 }, // Sábado
        { dayOfWeek: 0, startTime: "09:00", endTime: "20:00", maxOrders: 10 }  // Domingo
    ];

    console.log("Inserindo horários padrão (09:00 - 20:00)...");
    for (const slot of slots) {
        await prisma.availableSlot.create({ data: slot });
    }
    
    console.log("✅ Horários restaurados com sucesso!");
    process.exit(0);
}

fixSlots().catch(err => {
    console.error(err);
    process.exit(1);
});
