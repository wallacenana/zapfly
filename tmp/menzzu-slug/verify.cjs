const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(__dirname + '/script.js', 'utf8');
const context = { URL, URLSearchParams, state: { products: [] }, window: {
    location: { href: 'https://menzzu.com/confeitaria/?origem=teste', search: '' },
    history: { replaceState(data, title, url) {
        context.window.location.href = url;
        context.window.location.search = new URL(url).search;
    } }
} };
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('function productSlugName('), source.indexOf('// Função auxiliar')), context);
const cake = { id: '12345678-aaaa-bbbb-cccc-123456789012', name: 'Bolo de Chocolate' };
const coffee = { id: '98765432-aaaa-bbbb-cccc-123456789012', name: 'Café & Pão!' };
context.state.products = [cake, coffee];
assert.equal(context.productShareSlug(cake), 'bolo-de-chocolate');
assert.equal(context.productShareSlug(coffee), 'cafe-pao');
context.setProductUrl(cake);
assert.equal(context.getProductFromUrl(), cake);
assert.equal(new URL(context.window.location.href).searchParams.get('origem'), 'teste');
context.clearProductUrl();
assert.equal(context.getProductFromUrl(), null);
context.window.location.search = '?p=bolo-de-chocolate-' + cake.id;
assert.equal(context.getProductFromUrl(), cake);
const long = { id: 'long', name: 'Bolo de chocolate recheado com brigadeiro gourmet e cobertura especial para aniversario' };
assert.ok(context.productShareSlug(long).length <= 50);
assert.ok(!context.productShareSlug(long).endsWith('-'));
assert.ok(context.productSlugName(long).startsWith(context.productShareSlug(long) + '-'));
const duplicate = { ...cake, id: '12345679-aaaa-bbbb-cccc-123456789012' };
context.state.products = [cake, duplicate, coffee, long];
assert.notEqual(context.productShareSlug(cake), context.productShareSlug(duplicate));
for (const product of context.state.products) {
    context.setProductUrl(product);
    assert.equal(context.getProductFromUrl(), product);
    context.window.location.search = '?p=' + context.productSlugName(product) + '-' + product.id;
    assert.equal(context.getProductFromUrl(), product);
}
context.window.location.search = '?p=inexistente';
assert.equal(context.getProductFromUrl(), null);
assert.equal(context.productShareSlug({ id: 'empty', name: '!!!' }), 'produto');
console.log('OK: short slugs, accents, word boundaries, duplicate IDs, URL opening/clearing, unknown products and legacy links.');
