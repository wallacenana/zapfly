const test = require('node:test');
const assert = require('node:assert/strict');
const {
    formatProductAddonGroups,
    getEnabledFulfillmentMethods,
    formatFulfillmentMethods
} = require('../lib/ai');

test('formats add-on prices as increments and omits zero values', () => {
    const groups = new Map([['group-1', {
        id: 'group-1',
        name: 'Recheio dos bolos',
        min: 1,
        max: 2,
        items: JSON.stringify([
            { name: 'Ninho', price: 0 },
            { name: 'Sonho de valsa', price: 10 }
        ])
    }]]);
    const text = formatProductAddonGroups({ addonGroups: JSON.stringify(['group-1']) }, groups);

    assert.match(text, /Ninho\n/);
    assert.match(text, /Sonho de valsa: \+ R\$ 10\.00/);
    assert.doesNotMatch(text, /Ninho: R\$/);
    assert.doesNotMatch(text, /Grupo:/);
});

test('uses explicit fulfillment methods over the legacy delivery mode', () => {
    const settings = {
        deliveryMode: 'hibrido',
        dailyDeliveryItems: JSON.stringify({
            fulfillmentMethods: { delivery: false, pickup: true, local: false }
        })
    };

    assert.deepEqual(getEnabledFulfillmentMethods(settings), {
        delivery: false,
        pickup: true,
        local: false
    });
    assert.equal(formatFulfillmentMethods(settings), 'Retirada na loja');
});

test('does not re-enable fulfillment methods explicitly disabled by the store', () => {
    const settings = {
        deliveryMode: 'hibrido',
        dailyDeliveryItems: JSON.stringify({
            fulfillmentMethods: { delivery: false, pickup: false, local: false }
        })
    };

    assert.deepEqual(getEnabledFulfillmentMethods(settings), {
        delivery: false,
        pickup: false,
        local: false
    });
});
