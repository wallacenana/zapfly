const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveEffectivePrice } = require('../routes/orders');

test('inherits the variation price when a selected subitem is free', () => {
    const variation = { price: 36 };
    const subItem = { name: 'Baunilha', price: 0 };

    assert.equal(resolveEffectivePrice(subItem, resolveEffectivePrice(variation)), 36);
});

test('uses a paid subitem price and respects a valid promotion', () => {
    assert.equal(resolveEffectivePrice({ price: 42 }, 36), 42);
    assert.equal(resolveEffectivePrice({ price: 42, promoPrice: 35 }, 36), 35);
});
