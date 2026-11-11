
const http = require('http');
const qrcode = require('qrcode-terminal');

const PORT = process.env.PORT || 3000;
const ALLOWED_SENDER = process.env.ALLOWED_SENDER || '';

http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('WhatsApp Math Bot is running!');
}).listen(PORT, '0.0.0.0', () => {
  console.log('Web server running on port', PORT);
});

function normalizeArabic(text) {
  const digits = '٠١٢٣٤٥٦٧٨٩';
  return text
    .replace(/[٠-٩]/g, d => digits.indexOf(d))
    .replace(/٫/g, '.')
    .replace(/[×✖]/g, '*')
    .replace(/[÷]/g, '/')
    .replace(/[−–]/g, '-')
    .replace(/,/g, '.');
}

function getAnswer(text, math) {
  const normalized = normalizeArabic(text);
  const parts = normalized.split(/(?:أوجد|اوجد|احسب|حل)\s*(?:حل)?\s*[:：]?\s*/);
  const candidate = parts.length > 1 ? parts[parts.length - 1] : normalized;

  const match = candidate.match(/[0-9+\-*/().\s^]+/);
  if (!match) return null;

  const expression = match[0].trim();
  if (!expression || !/[0-9]/.test(expression)) return null;

  try {
    const result = math.evaluate(expression);
    if (typeof result !== 'number' || !Number.isFinite(result)) return null;
    return Number.isInteger(result) ? String(result) : String(Number(result.toFixed(8)));
  } catch {
    return null;
  }
}

async function startBot() {
  const baileys = await import('@whiskeysockets/baileys');
  const math = await import('mathjs');

  const { state, saveCreds } =
    await baileys.useMultiFileAuthState('./auth_info');

  const sock = baileys.default({
    auth: state,
    printQRInTerminal: false
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', update => {
    if (update.qr) {
      console.log('SCAN THIS QR WITH WHATSAPP:');
  const qrUrl = 'https://quickchart.io/qr?text=' + encodeURIComponent(update.qr) + '&size=500';
console.log('QR IMAGE LINK:', qrUrl);
    }

    if (update.connection === 'open') {
      console.log('WhatsApp connected!');
    }

    if (update.connection === 'close') {
      console.log('WhatsApp disconnected. Restarting...');
      setTimeout(startBot, 5000);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;

      const jid = msg.key.remoteJid;
      if (!jid || !jid.endsWith('@s.whatsapp.net')) continue;

      const text =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        '';

      if (!text) continue;

      if (!ALLOWED_SENDER) {
        console.log('Sender JID:', jid);
        continue;
      }

      if (jid !== ALLOWED_SENDER) continue;

      const answer = getAnswer(text, math);

      if (answer !== null) {
        await sock.sendMessage(jid, { text: answer });
        console.log('Answer sent.');
      }
    }
  });
}

startBot().catch(err => console.error('Bot error:', err));
