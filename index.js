
async function startBot() {
  const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason
  } = await import("@whiskeysockets/baileys");

  const { evaluate } = await import("mathjs");

  const { state, saveCreds } =
    await useMultiFileAuthState("./auth_info");

  const sock = makeWASocket({ auth: state });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", ({ connection, lastDisconnect }) => {
    if (connection === "open") console.log("WhatsApp connected!");

    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code !== DisconnectReason.loggedOut) startBot();
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;

      const sender = msg.key.remoteJid;
      if (!sender || sender.endsWith("@g.us") ||
          sender === "status@broadcast") continue;

      const text =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text;

      if (!text) continue;

      if (!process.env.ALLOWED_SENDER ||
          sender !== process.env.ALLOWED_SENDER) continue;

      try {
        let normalized = text
          .replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d))
          .replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d))
          .replace(/×/g, "*")
          .replace(/÷/g, "/")
          .replace(/[−–]/g, "-");

        const cue = normalized.match(
          /(?:حل|احسب|أحسب|أوجد|جد|الناتج)\s*[:：]?\s*(.*)/i
        );

        const source = cue ? cue[1] : normalized;

        const matches = source.match(
          /[0-9][0-9\s()+\-*/.%^]*/g
        );

        if (!matches) continue;

        const expression = matches
          .map(x => x.trim())
          .filter(x => /[+\-*/%^]/.test(x) && /\d/.test(x))
          .sort((a, b) => b.length - a.length)[0];

        if (!expression) continue;

        if (!/^[0-9+\-*/().%^ \t]+$/.test(expression)) continue;

        const result = evaluate(expression);

        if (typeof result !== "number" ||
            !Number.isFinite(result)) continue;

        await sock.sendMessage(sender, {
          text: String(result)
        });

      } catch (error) {
        console.log("Could not solve message");
      }
    }
  });
}

startBot().catch(console.error);
