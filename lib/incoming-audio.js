const OpenAI = require('openai');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { getOpenAI } = require('./ai');
const { getCachedInstance } = require('./cache');

function getIncomingAudioMessage(message) {
    let content = message?.message;
    while (content) {
        if (content.audioMessage) return content.audioMessage;
        content = content.ephemeralMessage?.message
            || content.viewOnceMessage?.message
            || content.viewOnceMessageV2?.message
            || content.viewOnceMessageV2Extension?.message;
    }
    return null;
}

async function transcribeIncomingAudio(message, instanceId) {
    const audio = getIncomingAudioMessage(message);
    if (!audio) return null;

    // The API key belongs to the owner of this WhatsApp connection.
    const instance = await getCachedInstance(instanceId);
    if (!instance?.userId) throw new Error('AUDIO_INSTANCE_OWNER_MISSING');
    const ai = await getOpenAI(instance.userId);
    if (!ai) throw new Error('AUDIO_API_KEY_MISSING');

    const stream = await downloadContentFromMessage(audio, 'audio');
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);
    if (!buffer.length) throw new Error('AUDIO_FILE_EMPTY');

    const mimeType = String(audio.mimetype || 'audio/ogg').split(';')[0].trim();
    const extensions = {
        'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'mp4',
        'audio/x-m4a': 'm4a', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
        'audio/webm': 'webm', 'audio/flac': 'flac'
    };
    const transcription = await ai.audio.transcriptions.create({
        file: await OpenAI.toFile(buffer, `audio.${extensions[mimeType] || 'ogg'}`, { type: mimeType }),
        model: 'whisper-1'
    });
    const text = String(transcription?.text || '').trim();
    if (!text) throw new Error('AUDIO_TRANSCRIPT_EMPTY');
    return text;
}

module.exports = { getIncomingAudioMessage, transcribeIncomingAudio };
