const test = require('node:test');
const assert = require('node:assert/strict');
const {
    formatProductAddonGroups,
    formatProductCustomFields,
    getEnabledFulfillmentMethods,
    formatFulfillmentMethods,
    formatAdminProductCatalog
} = require('../lib/ai');

test('uses variation prices in the administrative catalog when the base price is zero', () => {
    const text = formatAdminProductCatalog([{
        name: 'Coxinha de morango',
        price: 0,
        variations: JSON.stringify([
            { name: 'Unidade', price: 10, hidden: false },
            { name: 'Caixa', price: 25, hidden: false }
        ])
    }]);

    assert.match(text, /Coxinha de morango/);
    assert.match(text, /Unidade: R\$ 10\.00/);
    assert.match(text, /Caixa: R\$ 25\.00/);
    assert.doesNotMatch(text, /R\$\s*0(?:\.00)?\b/);
});

test('uses the base price when a product has no variations', () => {
    const text = formatAdminProductCatalog([{ name: 'Brigadeiro', price: 7.5, variations: '[]' }]);
    assert.match(text, /Brigadeiro.*R\$ 7\.50/);
});

test('keeps hidden variation prices visible to the administrator instead of using the base price', () => {
    const text = formatAdminProductCatalog([{
        name: 'Coxinha de morango', price: 0,
        variations: [{ name: 'Ninho com Nutella', price: 10, hidden: true }]
    }]);
    assert.match(text, /Ninho com Nutella: R\$ 10\.00/);
    assert.match(text, /INVISÍVEL/);
    assert.doesNotMatch(text, /R\$\s*0\.00/);
});

test('ignores stale base prices and uses variation promotions and subitem prices', () => {
    const text = formatAdminProductCatalog([{
        name: 'Coxinha de morango', price: 999, promoPrice: 888,
        variations: [
            { name: 'Ferrero rocher', price: 10, promoPrice: 8,
                subItems: [{ name: 'Tradicional', price: 0 }, { name: 'Especial', price: 15 }] },
            { name: 'Sem preço', price: 0 }
        ]
    }]);
    assert.match(text, /Ferrero rocher: R\$ 8\.00/);
    assert.match(text, /Tradicional: R\$ 8\.00/);
    assert.match(text, /Especial: R\$ 15\.00/);
    assert.doesNotMatch(text, /999|888|R\$ 0\.00|Sem preço: R\$/);
});

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
