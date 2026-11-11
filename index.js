
const http = require('http');
const QRCode = require('qrcode');

const PORT = process.env.PORT || 3000;
const QR_VIEW_TOKEN = process.env.QR_VIEW_TOKEN;

let latestQR = null;

// صفحة عرض QR المحمية بكلمة سر
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/qr') {
    if (
      !QR_VIEW_TOKEN ||
      url.searchParams.get('token') !== QR_VIEW_TOKEN
    ) {
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
      res.writeHead(500);
      return res.end('QR error');
    }
  }

  res.writeHead(200);
  res.end('WhatsApp AI Solver is running!');
}).listen(PORT, () => {
  console.log('Web server running on port', PORT);
});


// تشغيل واتساب
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

    // تجميع أجزاء السؤال من نفس المرسل
    const messageBuffers = new Map();

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;

      for (const msg of messages) {
        if (!msg.message || msg.key.fromMe) continue;

        const jid = msg.key.remoteJid;

        if (!jid || jid === 'status@broadcast') continue;

        const allowedSender = process.env.ALLOWED_SENDER;

        if (allowedSender && jid !== allowedSender) {
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

        const text = getText(msg.message).trim();

        if (!text) continue;

        const old = messageBuffers.get(jid);

        if (old) {
          clearTimeout(old.timer);
          old.text += '\n' + text;
        } else {
          messageBuffers.set(jid, {
            text: text,
            timer: null
          });
        }

        const current = messageBuffers.get(jid);

        current.timer = setTimeout(async () => {
          messageBuffers.delete(jid);

          try {
            const answer = await solveWithGemini(current.text);

            if (answer) {
              await sock.sendMessage(jid, {
                text: answer.trim()
              });
              console.log('Answer sent.');
            }
          } catch (error) {
            console.log('Answer error:', error.message);
          }
        }, 1800);
      }
    });

  } catch (error) {
    console.log('WhatsApp startup error:', error.message);
    setTimeout(startWhatsApp, 10000);
  }
}


// حل الأسئلة باستخدام Gemini
async function solveWithGemini(question) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is missing');
  }

  const response = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' +
      encodeURIComponent(apiKey),
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text:
                  'أنت مساعد متخصص في حل المسائل والأسئلة الدراسية. ' +
                  'حل السؤال بدقة، سواء كان رياضيات أو علوم أو سؤال نصي أو اختيار من متعدد. ' +
                  'إذا كان السؤال يحتوي خيارات، اختر الإجابة الصحيحة. ' +
                  'أرسل الإجابة النهائية فقط، بدون شرح أو مقدمة أو خطوات. ' +
                  'إذا كانت الإجابة حرفاً مثل A أو B فأرسل الحرف فقط.\n\n' +
                  'السؤال:\n' + question
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.2
        }
      })
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data.error?.message || 'Gemini API request failed'
    );
  }

  const answer = data.candidates?.[0]?.content?.parts
    ?.map(part => part.text || '')
    .join('')
    .trim();

  if (!answer) {
    throw new Error('No answer returned');
  }

  return answer;
}

startWhatsApp();
