require('dotenv').config();

const prisma = require('../lib/prisma');

const userId = process.argv.find((value) => value.startsWith('--user='))?.slice('--user='.length);
const dryRun = process.argv.includes('--dry-run');

if (!userId) {
    console.error('Use: node scripts/repair-order-totals.js --user=<userId> [--dry-run]');
    process.exit(1);
}

function getCartItems(order) {
    const parseItems = (rawValue, acceptArray) => {
        if (!rawValue) return [];
        try {
            const parsed = typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue;
            const items = Array.isArray(parsed) && acceptArray ? parsed : parsed?.cartItems;
            return Array.isArray(items) ? items.filter((item) => item && typeof item === 'object') : [];
        } catch (_) {
            return [];
        }
    };

    const cartItems = parseItems(order.cartItems, true);
    return cartItems.length > 0 ? cartItems : parseItems(order.addons, false);
}

function getCorrectTotal(order) {
    const itemsTotal = getCartItems(order).reduce((total, item) => (
        total + ((Number(item.price) || 0) * (Number(item.quantity) || 1))
    ), 0);
    return itemsTotal > 0 ? itemsTotal + (Number(order.deliveryFee) || 0) : null;
}

async function main() {
    const orders = await prisma.order.findMany({
        where: { userId },
        select: { id: true, totalValue: true, deliveryFee: true, cartItems: true, addons: true }
    });
    const corrections = orders.map((order) => ({ ...order, correctTotal: getCorrectTotal(order) }))
        .filter((order) => order.correctTotal !== null && Math.abs(order.correctTotal - Number(order.totalValue || 0)) > 0.005);

    console.log(JSON.stringify({
        mode: dryRun ? 'dry-run' : 'apply',
        scanned: orders.length,
        corrections: corrections.map((order) => ({
            id: order.id,
            from: Number(order.totalValue || 0).toFixed(2),
            to: order.correctTotal.toFixed(2)
        }))
    }, null, 2));

    if (dryRun || corrections.length === 0) return;

    await prisma.$transaction(corrections.map((order) => prisma.order.update({
        where: { id: order.id },
        data: { totalValue: order.correctTotal }
    })));
    console.log(`Updated ${corrections.length} order(s).`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
}).finally(() => prisma.$disconnect());
