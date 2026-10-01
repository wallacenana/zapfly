const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const OpenAI = require('openai');

function setup({ owner = 'store-a', missingKey = false, transcript = 'Quero encomendar para o dia 5', chunks = [Buffer.from('audio')] } = {}) {
    const calls = { owners: [], instances: [], downloads: [], requests: [] };
    const context = {
        module: { exports: {} }, Buffer,
        require(name) {
            if (name === 'openai') return OpenAI;
            if (name === './cache') return {
                getCachedInstance: async id => { calls.instances.push(id); return { userId: owner }; }
            };
            if (name === './ai') return {
                getOpenAI: async userId => {
                    calls.owners.push(userId);
                    if (missingKey) return null;
                    return { audio: { transcriptions: { create: async request => {
                        calls.requests.push(request);
                        return { text: transcript };
                    } } } };
                }
            };
            if (name === '@whiskeysockets/baileys') return {
                downloadContentFromMessage: async (audio, type) => {
                    calls.downloads.push({ audio, type });
                    return (async function* () { for (const chunk of chunks) yield chunk; })();
                }
            };
            throw new Error(`Unexpected dependency: ${name}`);
        }
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../lib/incoming-audio.js'), 'utf8'), context);
    return { ...context.module.exports, calls };
}

const audio = { mimetype: 'audio/ogg; codecs=opus', ptt: true };

test('transcribes using the connection owner key and returns usable text for persistence and AI', async () => {
    for (const owner of ['store-a', 'store-b']) {
        const helper = setup({ owner, transcript: '  Quero encomendar para o dia 5  ', chunks: [Buffer.from('one'), Buffer.from('two')] });
        const text = await helper.transcribeIncomingAudio({ message: { audioMessage: audio } }, 'connection-1');
        assert.equal(text, 'Quero encomendar para o dia 5');
        assert.deepEqual(helper.calls.instances, ['connection-1']);
        assert.deepEqual(helper.calls.owners, [owner]);
        assert.equal(helper.calls.downloads[0].audio, audio);
        assert.equal(helper.calls.downloads[0].type, 'audio');
        const request = helper.calls.requests[0];
        assert.equal(request.model, 'whisper-1');
        assert.equal(request.file.name, 'audio.ogg');
        assert.equal(request.file.type, 'audio/ogg');
        assert.equal(await request.file.text(), 'onetwo');
    }
});

test('recognizes and transcribes nested temporary and view-once audios', async () => {
    for (const wrapper of ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension']) {
        const helper = setup();
        const message = { message: { ephemeralMessage: { message: { [wrapper]: { message: { audioMessage: audio } } } } } };
        assert.equal(helper.getIncomingAudioMessage(message), audio);
        assert.equal(await helper.transcribeIncomingAudio(message, 'connection-1'), 'Quero encomendar para o dia 5');
    }
});

test('skips non-audio messages without accessing account settings or the API', async () => {
    const helper = setup();
    assert.equal(await helper.transcribeIncomingAudio({ message: { conversation: 'oi' } }, 'connection-1'), null);
    assert.equal(helper.calls.instances.length, 0);
    assert.equal(helper.calls.requests.length, 0);
});

test('reports missing ownership and API configuration instead of silently skipping transcription', async () => {
    for (const [options, error] of [
        [{ owner: null }, /AUDIO_INSTANCE_OWNER_MISSING/],
        [{ missingKey: true }, /AUDIO_API_KEY_MISSING/]
    ]) {
        const helper = setup(options);
        await assert.rejects(helper.transcribeIncomingAudio({ message: { audioMessage: audio } }, 'connection-1'), error);
        assert.equal(helper.calls.downloads.length, 0);
        assert.equal(helper.calls.requests.length, 0);
    }
});

test('rejects empty downloads and empty transcripts', async () => {
    for (const [options, error] of [
        [{ chunks: [] }, /AUDIO_FILE_EMPTY/],
        [{ transcript: '  ' }, /AUDIO_TRANSCRIPT_EMPTY/]
    ]) {
        const helper = setup(options);
        await assert.rejects(helper.transcribeIncomingAudio({ message: { audioMessage: audio } }, 'connection-1'), error);
    }
});

test('preserves supported audio container types for uploads', async () => {
    const helper = setup();
    await helper.transcribeIncomingAudio({ message: { audioMessage: { mimetype: 'audio/mp4' } } }, 'connection-1');
    assert.equal(helper.calls.requests[0].file.name, 'audio.mp4');
    assert.equal(helper.calls.requests[0].file.type, 'audio/mp4');
});
