const test = require('node:test');
const assert = require('node:assert/strict');
const { prepareAssistantReply, formatStoreLocation } = require('../lib/assistant-output');

test('rejects the leaked planning even when it follows a valid address', () => {
    const leaked = 'Rua Mal. Dutra, 5c\nhttps://maps.google.com/\n\n'
        + 'We need to respond as Lily. Check the conversation: The user earlier selected a product. '
        + 'We must follow system instruction: respond only to what customer asked.';
    assert.equal(prepareAssistantReply(leaked, 'Resposta segura'), 'Resposta segura');
});

test('rejects internal analysis markers, including incomplete blocks and Portuguese planning', () => {
    for (const leaked of [
        '<think>Choose what to send next</think>Oi!',
        'Oi!\n<analysis>Internal draft',
        '[ANALISE: internal draft]',
        'Reasoning: check the earlier conversation',
        'Precisamos seguir as instruções da loja antes de responder como Lily.'
    ]) assert.equal(prepareAssistantReply(leaked, 'Resposta segura'), 'Resposta segura');
});

test('keeps useful customer replies and complete order summaries intact', () => {
    for (const reply of [
        'Estamos na Rua Mal. Dutra, 5c.\nhttps://maps.google.com/',
        'Você prefere retirada ou entrega?',
        '*Resumo do pedido*\nBolo P: R$ 25,00\nEntrega: R$ 5,00\nTotal: R$ 30,00\nPosso confirmar?'
    ]) assert.equal(prepareAssistantReply(reply), reply);
});

test('blocks excessive output without sending a truncated order or partial internal draft', () => {
    assert.equal(prepareAssistantReply('texto '.repeat(400), 'Resposta segura'), 'Resposta segura');
    assert.equal(prepareAssistantReply(null, 'Resposta segura'), 'Resposta segura');
    assert.equal(prepareAssistantReply('  ', 'Resposta segura'), 'Resposta segura');
});

test('location response contains only registered address and map link', () => {
    assert.equal(formatStoreLocation({
        businessAddress: 'Rua Mal. Dutra, 5c',
        businessLocation: { mapsUrl: 'https://maps.google.com/?q=loja' },
        botPrompt: 'Internal store instructions'
    }), 'Rua Mal. Dutra, 5c\nhttps://maps.google.com/?q=loja');
});

test('supports existing string and JSON map settings and updated profile fields', () => {
    assert.equal(formatStoreLocation({ businessLocation: 'https://maps.google.com/' }), 'https://maps.google.com/');
    assert.equal(formatStoreLocation({ businessLocation: JSON.stringify({ address: 'Rua A', locationLink: 'https://maps.google.com/' }) }), 'Rua A\nhttps://maps.google.com/');
    assert.equal(formatStoreLocation({ businessAddress: 'Rua Nova', businessMapsUrl: 'https://maps.google.com/new', businessLocation: { address: 'Rua Velha' } }), 'Rua Nova\nhttps://maps.google.com/new');
});

test('does not invent locations or expose malformed map settings', () => {
    assert.equal(formatStoreLocation({}), 'A localização da loja ainda não está cadastrada.');
    assert.equal(formatStoreLocation({ businessAddress: 'Rua A', businessLocation: 'javascript:alert(1)' }), 'Rua A');
    assert.equal(formatStoreLocation({ businessAddress: 'Rua A', businessLocation: '{broken' }), 'Rua A');
});
