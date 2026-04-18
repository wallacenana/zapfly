const baileys = require('@whiskeysockets/baileys');
console.log('Has makeInMemoryStore:', !!baileys.makeInMemoryStore);
console.log('Type of makeInMemoryStore:', typeof baileys.makeInMemoryStore);

// Check common locations if not in main export
try {
    const store = require('@whiskeysockets/baileys/lib/Store');
    console.log('Keys in Store lib:', Object.keys(store));
} catch(e) {
    console.log('Could not require Store lib');
}
