
const http = require('http');

const PORT = process.env.PORT || 3000;

http.createServer((req, res) => {
  res.writeHead(200);
  res.end('WhatsApp Gemini AI Bot is running!');
}).listen(PORT, () => {
  console.log('Web server running on port', PORT);
});

async function startBot() {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is missing');
  }

  const baileys = await import('@whiskeysockets/baileys');
  const makeWASocket = baileys.default || baileys.makeWASocket;
  const { useMultiFileAuthState, DisconnectReason } = baileys;

  const { GoogleGenAI } = await import('@google/genai');
  const qrcode = require('qrcode-terminal');

  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY
  });

  const { state, saveCreds } =
    await useMultiFileAuthState('./auth_info');

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', ({ connection, qr, lastDisconnect }) => {
    if (qr) {
      console.log('NEW WHATSAPP QR:');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'open') {
      console.log('WhatsApp connected!');
    }

    if (connection === 'close') {
      const status = lastDisconnect?.error?.output?.statusCode;

      if (status !== DisconnectReason.loggedOut) {
        console.log('Connection closed. Restarting...');
        setTimeout(() => startBot().catch(console.error), 5000);
      } else {
        console.log('WhatsApp logged out. Pairing required.');
      }
    }
  });

  function getText(message) {
    if (!message) return '';

    if (message.ephemeralMessage) {
      return getText(message.ephemeralMessage.message);
    }

    if (message.viewOnceMessage) {
      return getText(message.viewOnceMessage.message);
    }

    if (message.viewOnceMessageV2) {
      return getText(message.viewOnceMessageV2.message);
    }

    return (
      message.conversation ||
      message.extendedTextMessage?.text ||
      message.imageMessage?.caption ||
      message.videoMessage?.caption ||
      message.documentMessage?.caption ||
      message.buttonsResponseMessage?.selectedDisplayText ||
      message.listResponseMessage?.title ||
      message.templateButtonReplyMessage?.selectedDisplayText ||
      ''
    );
  }

  async function solveWithAI(question) {
    const response = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL || 'gemini-flash-latest',
      contents: question,
      config: {
        temperature: 0.1,
        maxOutputTokens: 400,
        systemInstruction: `
أنت مساعد تعليمي متخصص في حل أسئلة الطلاب.

افهم السؤال باللغة العربية أو الإنجليزية.
حل المعادلات والرياضيات والمسائل الكلامية.
افهم أسئلة الاختيار من متعدد واختر الإجابة الصحيحة.
إذا وصل السؤال على عدة رسائل، اقرأها كسؤال واحد إذا كانت أجزاء مترابطة.
إذا وصلت عدة أسئلة كاملة، أجب عنها بالترتيب، كل إجابة في سطر.
تحقق من الحسابات قبل الإجابة.
لا تخترع إجابة إذا كانت المعطيات غير كافية.
أرسل الإجابة النهائية فقط دون شرح أو مقدمات.
في المعادلات اكتب المتغير وقيمته، مثل: a = 5.
في الاختيارات اكتب حرف الخيار فقط إذا كان المطلوب اختيار حرف.
لا تكتب عبارات مثل: الإجابة الصحيحة هي.
`
      }
    });

    return (response.text || '').trim();
  }

  const allowedSender = process.env.ALLOWED_SENDER || '';

  const pending = new Map();
  const seen = new Set();

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      try {
        if (!msg.message || msg.key.fromMe) continue;

        const jid = msg.key.remoteJid;

        if (
          !jid ||
          jid.endsWith('@g.us') ||
          jid === 'status@broadcast'
        ) continue;

        const id = msg.key.id;

        if (id && seen.has(id)) continue;

        if (id) {
          seen.add(id);
          if (seen.size > 3000) {
            seen.clear();
          }
        }

        console.log('Incoming sender:', jid);

        if (!allowedSender || jid !== allowedSender) {
          console.log('Sender not authorized. Check ALLOWED_SENDER.');
          continue;
        }

        const text = getText(msg.message).trim();
        if (!text) continue;

        let item = pending.get(jid);

        if (!item) {
          item = { parts: [], timer: null };
          pending.set(jid, item);
        }

        item.parts.push(text);

        clearTimeout(item.timer);

        item.timer = setTimeout(async () => {
          pending.delete(jid);

          const question = item.parts.join('\n');

          try {
            console.log('Sending question to Gemini...');

            const answer = await solveWithAI(question);

            if (!answer) {
              console.log('Gemini returned an empty answer.');
              return;
            }

            await sock.sendMessage(jid, {
              text: answer
            });

            console.log('Answer sent successfully.');

          } catch (error) {
            console.error('Gemini/message error:', error.message);
          }
        }, 2000);

      } catch (error) {
        console.error('Incoming message error:', error.message);
      }
    }
  });
}

startBot().catch(error => {
  console.error('Startup error:', error);
});
