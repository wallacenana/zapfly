const test = require('node:test');
const assert = require('node:assert/strict');
const { isSameDayOrderAllowed, buildAvailabilityByPeriod } = require('../routes/orders');

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

test('groups available scheduling times into contiguous periods', () => {
    const periods = buildAvailabilityByPeriod([
        { time: '09:30', available: true },
        { time: '09:45', available: true },
        { time: '10:00', available: false },
        { time: '12:15', available: true },
        { time: '12:30', available: true },
        { time: '14:00', available: true }
    ]);

    assert.deepEqual(periods, [
        { period: 'manhã', ranges: [{ start: '09:30', end: '09:45' }] },
        { period: 'tarde', ranges: [{ start: '12:15', end: '12:30' }, { start: '14:00', end: '14:00' }] }
    ]);
});
