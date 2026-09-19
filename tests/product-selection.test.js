const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const products = [
    { name: 'Vulcao', type: 'delivery', variations: JSON.stringify([
        { name: 'Mini' },
        { name: 'P', subItems: [{ name: 'Chocolate' }, { name: 'Baunilha' }] },
        { name: 'G', hidden: true }
    ]) },
    { name: 'Brigadeiros', type: 'encomenda', variations: '[]' }
];
const context = {
    module: { exports: {} },
    require: name => {
        if (name === './prisma') return {};
        if (name === './cache') return { getCachedProducts: async () => products };
        throw new Error(`Unexpected dependency: ${name}`);
    }
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../lib/utils.js'), 'utf8'), context);
const { findSelectedProduct, isCatalogRequest, isFinalOrderConfirmation } = context.module.exports;
const history = [{ role: 'assistant', content: 'Qual tamanho do Vulcao voce quer? Mini: R$ 18.00; P: R$ 25.00' }];

test('recognizes product names with descriptive prefixes', async () => {
    assert.equal((await findSelectedProduct('u', 'quero bolo vulcao', true)).name, 'Vulcao');
});

test('continues the product selection for short size and option replies', async () => {
    for (const reply of ['p', 'P', 'quero o P', 'tamanho P', 'Chocolate', 'Baunilha']) {
        assert.equal(isCatalogRequest(reply), false);
        assert.equal((await findSelectedProduct('u', reply, true, history)).name, 'Vulcao');
    }
});

test('does not guess products without context or from a full catalog', async () => {
    assert.equal(await findSelectedProduct('u', 'p', true), null);
    assert.equal(await findSelectedProduct('u', 'p', false, [
        { role: 'assistant', content: 'Vulcao e Brigadeiros' }
    ]), null);
    assert.equal(await findSelectedProduct('u', 'p', true, [
        ...history, { role: 'assistant', content: 'Para qual dia?' }
    ]), null);
});

test('ignores hidden and unknown options and preserves catalog requests', async () => {
    for (const reply of ['G', 'inexistente', 'nao quero P']) {
        assert.equal(await findSelectedProduct('u', reply, true, history), null);
    }
    assert.equal(isCatalogRequest('me manda o cardapio novamente'), true);
});

test('recognizes only an explicit response to the final order confirmation', () => {
    const finalSummary = [{ role: 'assistant', content: 'Total: R$ 40,00. Por favor, confirme se posso prosseguir com o pedido.' }];
    assert.equal(isFinalOrderConfirmation(finalSummary, 'sim'), true);
    assert.equal(isFinalOrderConfirmation(finalSummary, 'pode prosseguir'), true);
    assert.equal(isFinalOrderConfirmation([{ role: 'assistant', content: 'Você confirma a entrega neste endereço?' }], 'sim'), false);
    assert.equal(isFinalOrderConfirmation(finalSummary, 'quero alterar'), false);
});
