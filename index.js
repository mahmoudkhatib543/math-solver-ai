
const http = require('http');
const QRCode = require('qrcode');

const PORT = process.env.PORT || 3000;
const QR_VIEW_TOKEN = process.env.QR_VIEW_TOKEN;
const GEMINI_MODEL = 'gemini-3.8-flash';

let latestQR = null;

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/qr') {
    if (!QR_VIEW_TOKEN || url.searchParams.get('token') !== QR_VIEW_TOKEN) {
      res.writeHead(403);
      return res.end('Forbidden');
    }

    if (!latestQR) {
      res.writeHead(404);
      return res.end('QR not ready. Refresh later.');
    }

    try {
      const image = await QRCode.toDataURL(latestQR, {
        width: 360,
        margin: 2
      });

      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store'
      });

      return res.end(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <title>WhatsApp QR</title>
        </head>
        <body style="text-align:center;font-family:Arial;padding:20px">
          <h2>WhatsApp QR</h2>
          <img src="${image}" style="width:360px;max-width:100%">
          <p>امسح الرمز من واتساب</p>
        </body>
        </html>
      `);
    } catch (error) {
      console.error('QR error:', error.message);
      res.writeHead(500);
      return res.end('QR error');
    }
  }

  res.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8'
  });
  res.end('WhatsApp AI Solver is running!');
}).listen(PORT, () => {
  console.log('Web server running on port', PORT);
});

async function startWhatsApp() {
  try {
    const {
      default: makeWASocket,
      useMultiFileAuthState,
      DisconnectReason
    } = await import('@whiskeysockets/baileys');

    const { state, saveCreds } =
      await useMultiFileAuthState('./auth_info');

    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
      const { connection, qr, lastDisconnect } = update;

      console.log('CONNECTION UPDATE:', JSON.stringify({
        connection,
        hasQR: !!qr,
        statusCode: lastDisconnect?.error?.output?.statusCode
      }));

      if (qr) {
        latestQR = qr;
        console.log('QR is ready. Open your private QR link.');
      }

      if (connection === 'open') {
        latestQR = null;
        console.log('WhatsApp connected!');
      }

      if (connection === 'close') {
        const code =
          lastDisconnect?.error?.output?.statusCode;

        console.log('WhatsApp connection closed:', code);

        if (code !== DisconnectReason.loggedOut) {
          setTimeout(() => startWhatsApp(), 5000);
        } else {
          console.log('WhatsApp logged out. Re-link required.');
        }
      }
    });

    const messageBuffers = new Map();

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      console.log(
        'MESSAGE EVENT:',
        type,
        'COUNT:',
        messages.length
      );

      if (type !== 'notify') return;

      for (const msg of messages) {
        if (!msg.message || msg.key.fromMe) continue;

        const jid = msg.key.remoteJid;

        if (!jid || jid === 'status@broadcast') continue;
        if (jid.endsWith('@g.us')) continue;

        const allowedSender = process.env.ALLOWED_SENDER;

        if (allowedSender && jid !== allowedSender) {
          console.log('Message ignored: sender not allowed.');
          continue;
        }

        function getText(message) {
          if (!message) return '';

          if (message.conversation) {
            return message.conversation;
          }

          if (message.extendedTextMessage?.text) {
            return message.extendedTextMessage.text;
          }

          if (message.imageMessage?.caption) {
            return message.imageMessage.caption;
          }

          if (message.documentMessage?.caption) {
            return message.documentMessage.caption;
          }

          if (message.ephemeralMessage?.message) {
            return getText(message.ephemeralMessage.message);
          }

          if (message.viewOnceMessage?.message) {
            return getText(message.viewOnceMessage.message);
          }

          if (message.viewOnceMessageV2?.message) {
            return getText(message.viewOnceMessageV2.message);
          }

          return '';
        }

        const question = getText(msg.message).trim();

        if (!question) {
          console.log('Message received, but it has no supported text.');
          continue;
        }

        console.log('INCOMING TEXT:', question);

        const old = messageBuffers.get(jid);

        if (old) {
          clearTimeout(old.timer);
          old.text += '\n' + question;
        } else {
          messageBuffers.set(jid, {
            text: question,
            timer: null
          });
        }

        const current = messageBuffers.get(jid);

        current.timer = setTimeout(async () => {
          messageBuffers.delete(jid);

          console.log('Solving question from:', jid);
          console.log('Question length:', current.text.length);

          try {
            const answer = await solveWithGemini(current.text);

            console.log('Gemini answer received.');

            await sock.sendMessage(jid, {
              text: answer
            });

            console.log('Answer sent successfully.');
          } catch (error) {
            console.error('Answer error:', error.message);
          }
        }, 1800);
      }
    });

    console.log('WhatsApp socket created. Waiting for connection...');

  } catch (error) {
    console.error('WhatsApp startup error:', error.message);
    setTimeout(startWhatsApp, 10000);
  }
}

async function solveWithGemini(question) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is missing in Render Environment.');
  }

  console.log('Sending question to Gemini model:', GEMINI_MODEL);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=` +
        encodeURIComponent(apiKey),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text:
                    'أنت مساعد متخصص في حل الأسئلة الدراسية. ' +
                    'حل المسائل الرياضية والعلوم والأسئلة النصية والاختيارات المتعددة بدقة. ' +
                    'إذا وجدت خيارات، اختر الإجابة الصحيحة. ' +
                    'أرسل الإجابة النهائية فقط، دون شرح أو مقدمة أو خطوات. ' +
                    'إذا كانت الإجابة حرفًا مثل A أو B فأرسل الحرف فقط.\n\n' +
                    'السؤال:\n' + question
                }
              ]
            }
          ]
        })
      }
    );

    const data = await response.json();

    console.log('Gemini HTTP Status:', response.status);

    if (!response.ok) {
      const message = data.error?.message || JSON.stringify(data);
      throw new Error(`Gemini API error (${response.status}): ${message}`);
    }

    const answer = data.candidates?.[0]?.content?.parts
      ?.map(part => part.text || '')
      .join('')
      .trim();

    if (!answer) {
      console.log(
        'Gemini returned no text:',
        JSON.stringify(data).slice(0, 1500)
      );

      throw new Error(
        data.promptFeedback?.blockReason ||
        data.candidates?.[0]?.finishReason ||
        'Gemini returned an empty answer'
      );
    }

    return answer;

  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Gemini request timed out after 45 seconds.');
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

startWhatsApp();
