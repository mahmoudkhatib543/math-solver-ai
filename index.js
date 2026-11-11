
const http = require('http');
const qrcode = require('qrcode-terminal');

const PORT = process.env.PORT || 3000;
const ALLOWED_SENDER = process.env.ALLOWED_SENDER || '';

http.createServer((req, res) => {
  res.writeHead(200);
  res.end('WhatsApp Math Bot is running!');
}).listen(PORT, () => {
  console.log('Web server running on port', PORT);
});

function normalize(text) {
  return text
    .replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/[−–]/g, '-')
    .replace(/٫/g, '.')
    .replace(/,/g, '.')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractText(message) {
  if (!message) return '';

  if (message.ephemeralMessage) {
    return extractText(message.ephemeralMessage.message);
  }

  if (message.viewOnceMessage) {
    return extractText(message.viewOnceMessage.message);
  }

  return (
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.documentMessage?.caption ||
    ''
  );
}

function solveQuestion(text, math, nerdamer) {
  const clean = normalize(text);

  // المعادلات
  const equations = clean.match(
    /[0-9a-zA-Z().+\-*/^ \t]+=[0-9a-zA-Z().+\-*/^ \t]+/g
  );

  if (equations) {
    for (const equation of equations) {
      const variables = [...new Set(
        equation.match(/[a-zA-Z]/g) || []
      )];

      if (variables.length === 1) {
        try {
          const variable = variables[0];
          const result = nerdamer
            .solve(equation.trim(), variable)
            .toString()
            .replace(/^\[|\]$/g, '');

          if (result && result !== '[]') {
            return `${variable} = ${result}`;
          }
        } catch (e) {
          console.log('Equation error:', e.message);
        }
      }
    }
  }

  // العمليات الحسابية
  const expressions = clean.match(
    /[0-9][0-9().+\-*/^ \t]*[+\-*/^][0-9().+\-*/^ \t]*/g
  );

  if (expressions) {
    for (const expression of expressions) {
      try {
        const result = math.evaluate(expression.trim());

        if (typeof result === 'number' && Number.isFinite(result)) {
          return String(Number(result.toFixed(8)));
        }
      } catch (e) {}
    }
  }

  return null;
}

async function startBot() {
  const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason
  } = await import('@whiskeysockets/baileys');

  const math = require('mathjs');
  const nerdamer = require('nerdamer');

  const { state, saveCreds } =
    await useMultiFileAuthState('./auth_info');

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', ({ connection, qr, lastDisconnect }) => {
    if (qr) {
      console.log('SCAN THIS QR CODE:');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'open') {
      console.log('WhatsApp connected!');
    }

    if (connection === 'close') {
      const status = lastDisconnect?.error?.output?.statusCode;

      if (status !== DisconnectReason.loggedOut) {
        console.log('Connection closed. Restarting...');
        setTimeout(startBot, 5000);
      } else {
        console.log('WhatsApp logged out. New pairing required.');
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const message of messages) {
      try {
        if (!message.message || message.key.fromMe) continue;

        const jid = message.key.remoteJid;

        if (!jid || jid.endsWith('@g.us') || jid === 'status@broadcast') {
          continue;
        }

        console.log('Sender JID:', jid);

        if (ALLOWED_SENDER && jid !== ALLOWED_SENDER) {
          continue;
        }

        const text = extractText(message.message);
        if (!text) continue;

        console.log('Incoming text received');

        const answer = solveQuestion(text, math, nerdamer);

        if (answer) {
          await sock.sendMessage(jid, { text: answer });
          console.log('Answer sent');
        } else {
          console.log('No mathematical answer found');
        }
      } catch (error) {
        console.log('Message error:', error.message);
      }
    }
  });
}

startBot().catch(error => {
  console.error('Bot startup error:', error);
});
