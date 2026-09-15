const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'node_modules', '@whiskeysockets', 'baileys', 'lib', 'Socket', 'messages-send.js');

if (!fs.existsSync(filePath)) {
    console.warn('[Baileys patch] messages-send.js não encontrado; rode npm install novamente.');
    process.exit(0);
}

let source = fs.readFileSync(filePath, 'utf8');
const original = source;

if (!source.includes('const additionalAttributes = { ...(options.additionalAttributes || {}) };')) {
    source = source.replace(
        'const additionalAttributes = {};',
        'const additionalAttributes = { ...(options.additionalAttributes || {}) };'
    );
}
if (!source.includes("additionalAttributes.addressing_mode = 'lid'")) {
    source = source.replace(
        'const isStatus = jid === statusJid;',
        "const isStatus = jid === statusJid;\n        if (isStatus) {\n            additionalAttributes.addressing_mode = 'lid';\n        }"
    );
}

if (source !== original) {
    fs.writeFileSync(filePath, source);
    console.log('[Baileys patch] Suporte de addressing_mode aplicado ao Status.');
} else if (!source.includes("additionalAttributes.addressing_mode = 'lid'")) {
    console.warn('[Baileys patch] Estrutura inesperada; patch não aplicado.');
} else {
    console.log('[Baileys patch] Status já está corrigido.');
}
