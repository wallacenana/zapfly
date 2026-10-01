const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { hasCustomAssistantInstructions } = require('../lib/ai');
const { formatConversationHistoryMessage } = require('../lib/utils');

const rule = 'Você está completamente proibida de fazer encomendas. Informe que a equipe responderá mais tarde; pode passar informações sobre produtos.';

function promptBuilder(instances) {
    const context = {
        module: { exports: {} }, console,
        require(name) {
            if (name === './cache') return {
                getSettings: async () => ({ businessName: 'Loja', botPrompt: 'Identidade antiga' }),
                getCachedProducts: async () => [],
                getCachedInstance: async id => instances[id]
            };
            if (name === './prisma') return {
                addonGroup: { findMany: async () => [] },
                customer: { findUnique: async () => null }
            };
            if (name === './utils') return require('../lib/utils');
            if (['openai', 'axios', './status-media', './maps'].includes(name)) return {};
            throw new Error(`Unexpected dependency: ${name}`);
        }
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../lib/ai.js'), 'utf8'), context);
    const storeInfo = { statusLoja: 'ABERTA', nomeDia: 'Quinta-feira', horaAtual: '16:42', dataAtual: '01/10/2026', hoje: new Date('2026-10-01T19:42:00Z') };
    return (id, flowPrompt = '') => context.module.exports.buildLilyPrompt(id, 'customer', flowPrompt, storeInfo, 'Cliente', 'owner');
}

test('real customer prompt contains the saved connection prompt and FAQ restrictions', async () => {
    const build = promptBuilder({ a: {
        assistantName: 'Lily', botPrompt: 'Atenda com objetividade.',
        knowledge: JSON.stringify([{ q: 'Sobre encomendas', a: rule }])
    } });
    const prompt = await build('a');
    assert.ok(prompt.includes(rule));
    assert.ok(prompt.includes('Sobre encomendas'));
    assert.ok(prompt.includes('Atenda com objetividade.'));
    assert.ok(!prompt.includes('Identidade antiga'));
    assert.ok(prompt.indexOf(rule) > prompt.indexOf('REGRA ABSOLUTA DE COLETA SEQUENCIAL'));
    assert.match(prompt, /Restricoes da loja prevalecem/);
    assert.match(prompt, /Nao afirme disponibilidade nem indisponibilidade sem um resultado bem-sucedido/);
});

test('flow instructions reach the prompt but store restrictions retain priority', async () => {
    const build = promptBuilder({ a: { knowledge: [{ q: 'Encomendas', a: rule }] } });
    const prompt = await build('a', 'Ajude o cliente com o pedido.');
    assert.ok(prompt.includes('Ajude o cliente com o pedido.'));
    assert.ok(prompt.indexOf(rule) > prompt.indexOf('Ajude o cliente com o pedido.'));
});

test('different connections receive only their own configured instructions', async () => {
    const build = promptBuilder({
        a: { knowledge: [{ q: 'Encomendas', a: rule }] },
        b: { botPrompt: 'Assistente da segunda loja', knowledge: '[]' }
    });
    assert.ok((await build('a')).includes(rule));
    assert.ok(!(await build('b')).includes(rule));
    assert.ok((await build('b')).includes('Assistente da segunda loja'));
});

test('custom instructions disable forced tool routing while empty or invalid knowledge does not', () => {
    assert.equal(hasCustomAssistantInstructions({ knowledge: JSON.stringify([{ q: 'Encomendas', a: rule }]) }), true);
    assert.equal(hasCustomAssistantInstructions({ botPrompt: 'Somente informações' }), true);
    assert.equal(hasCustomAssistantInstructions({}, 'Não agende pedidos'), true);
    for (const knowledge of ['[]', '{}', 'invalid', '[null, {"q":"Sem resposta"}]']) {
        assert.equal(hasCustomAssistantInstructions({ knowledge }), false);
    }
});

test('conversation context preserves the date of relative dates and the quoted message', () => {
    const message = formatConversationHistoryMessage({
        fromMe: true, text: 'Amanhã esse horário', quotedText: 'Eu vou pegar umas 17:30h',
        timestamp: '2026-09-30T20:30:00Z'
    });
    assert.equal(message.role, 'assistant');
    assert.match(message.content, /30\/09\/2026.*17:30/);
    assert.ok(message.content.includes('Amanhã esse horário'));
    assert.ok(message.content.includes('Mensagem citada: Eu vou pegar umas 17:30h'));
});

test('history entries without a timestamp do not acquire a fabricated date', () => {
    const message = formatConversationHistoryMessage({ fromMe: false, text: 'Sim' });
    assert.equal(message.role, 'user');
    assert.equal(message.content, 'Sim');
});

test('invalidating saved connection instructions refreshes the instance cache immediately', async () => {
    let saved = { id: 'a', knowledge: 'old' };
    const context = {
        module: { exports: {} },
        require(name) {
            if (name === './prisma') return { instance: { findUnique: async () => ({ ...saved }) } };
            if (name === './storeProfile') return {};
            throw new Error(`Unexpected dependency: ${name}`);
        }
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../lib/cache.js'), 'utf8'), context);
    const { getCachedInstance, invalidateInstanceCache } = context.module.exports;
    assert.equal((await getCachedInstance('a')).knowledge, 'old');
    saved = { id: 'a', knowledge: 'new' };
    invalidateInstanceCache('a');
    assert.equal((await getCachedInstance('a')).knowledge, 'new');
});
