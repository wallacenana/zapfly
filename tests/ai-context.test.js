const test = require('node:test');
const assert = require('node:assert/strict');
const {
    formatProductAddonGroups,
    formatProductCustomFields,
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

test('omits the quantity hint for a single required add-on choice', () => {
    const groups = new Map([['group-1', {
        id: 'group-1', name: 'Massa', min: 1, max: 1,
        items: JSON.stringify([{ name: 'Chocolate', price: 0 }])
    }]]);
    const text = formatProductAddonGroups({ addonGroups: JSON.stringify(['group-1']) }, groups);

    assert.match(text, /- Massa\n/);
    assert.doesNotMatch(text, /1 a 1/);
});

test('adds product custom fields to the assistant catalog context', () => {
    const text = formatProductCustomFields({
        customFields: JSON.stringify([
            { name: 'Referência do bolo', type: 'image', required: true, multiple: true },
            { name: 'Informações do topo', type: 'text', required: true },
            { name: 'Cor', type: 'dropdown', options: 'Rosa, Azul', required: false }
        ])
    });

    assert.match(text, /Referência do bolo \(imagem; obrigatorio; varias imagens permitidas\)/);
    assert.match(text, /Informações do topo \(texto; obrigatorio\)/);
    assert.match(text, /Cor \(lista; opcoes: Rosa, Azul\)/);
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
