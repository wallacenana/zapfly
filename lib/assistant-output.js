const MAX_ASSISTANT_REPLY_LENGTH = 1800;
const INVALID_REPLY_FALLBACK = 'Não consegui preparar a resposta corretamente. Pode repetir sua pergunta?';

// Reject the whole draft: trimming an internal monologue can still expose fragments.
function prepareAssistantReply(value, fallback = INVALID_REPLY_FALLBACK) {
    const text = typeof value === 'string' ? value.trim() : '';
    const internalText = /<\/?(?:think|thinking|analysis|reasoning)(?:\s|>)|\[(?:ANALISE|ANÁLISE|analysis|reasoning)\s*:|(?:^|\n)\s*(?:analysis|reasoning|internal (?:notes|analysis)|racioc[ií]nio interno)\s*:/i;
    const planning = /\b(?:we|i)\s+(?:need|must|should)\s+(?:to\s+)?(?:respond|follow|answer|comply|obey|check the (?:conversation|context))\b|\b(?:system|developer)\s+(?:prompt|instructions?)\b|\b(?:preciso|precisamos|devo|devemos)\s+(?:responder como|seguir as instru[cç][oõ]es|analisar a conversa)\b/i;
    if (!text || text.length > MAX_ASSISTANT_REPLY_LENGTH || internalText.test(text) || planning.test(text)) {
        return fallback;
    }
    return text;
}

function formatStoreLocation(settings = {}) {
    let location = settings.businessLocation;
    if (typeof location === 'string') {
        try { location = JSON.parse(location); } catch (_) { location = { mapsUrl: location }; }
    }
    if (!location || typeof location !== 'object') location = {};
    const address = String(settings.businessAddress || location.address || location.formatted_address || '').trim();
    const rawUrl = settings.businessMapsUrl || location.mapsUrl || location.locationLink;
    let link = '';
    try {
        const url = new URL(rawUrl);
        if (['https:', 'http:'].includes(url.protocol)) link = url.href;
    } catch (_) { /* An address remains useful when no map link is configured. */ }
    return [address, link].filter(Boolean).join('\n') || 'A localização da loja ainda não está cadastrada.';
}

module.exports = { prepareAssistantReply, formatStoreLocation };
