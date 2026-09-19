const test = require('node:test');
const assert = require('node:assert/strict');
const { isSameDayOrderAllowed } = require('../routes/orders');

test('blocks same-day orders unless the store enabled them', () => {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(new Date());
    const date = Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
    const today = `${date.year}-${date.month}-${date.day}`;

    assert.equal(isSameDayOrderAllowed({}, today, 'order'), false);
    assert.equal(isSameDayOrderAllowed({ acceptSameDayOrders: true }, today, 'order'), true);
    assert.equal(isSameDayOrderAllowed({}, '2099-01-01', 'order'), true);
    assert.equal(isSameDayOrderAllowed({}, today, 'delivery'), true);
});
