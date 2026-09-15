const axios = require('axios');

async function getStatusImage(url) {
    let sharp;
    try {
        sharp = require('sharp');
    } catch (err) {
        console.warn('[WhatsApp] sharp não está instalado; usando a imagem original do Status. Execute npm install.');
        return { url };
    }

    const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 30000,
        maxContentLength: 20 * 1024 * 1024,
        maxBodyLength: 20 * 1024 * 1024
    });

    const buffer = await sharp(Buffer.from(response.data))
        .rotate()
        .jpeg({ quality: 90, chromaSubsampling: '4:4:4' })
        .toBuffer();

    console.log(`[WhatsApp] Imagem do Status normalizada para JPEG (${buffer.length} bytes).`);
    return buffer;
}

module.exports = { getStatusImage };
