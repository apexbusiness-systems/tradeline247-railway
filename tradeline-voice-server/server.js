require('dotenv').config();
const express = require('express');
const { createServer } = require('http');
const { WebSocketServer } = require('ws');
const OpenAI = require('openai');
const helmet = require('helmet');
const twilio = require('twilio');

// -- Configuration --
const PORT = process.env.PORT || 8080;
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;

// -- Environment Validation --
if (!process.env.OPENAI_API_KEY) {
  console.error('FATAL: OPENAI_API_KEY is missing.');
    // process.exit(1);
}
if (!TWILIO_AUTH_TOKEN) {
  console.error('FATAL: TWILIO_AUTH_TOKEN is missing.');
    // process.exit(1);
}
if (!PUBLIC_BASE_URL) {
  console.error('FATAL: PUBLIC_BASE_URL is missing.');
    // process.exit(1);
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const app = express();

// -- Middleware --
app.set('trust proxy', true);
app.use(helmet());
app.use(express.urlencoded({ extended: true })); // Twilio sends form-urlencoded
app.use(express.json());

// -- Health Check --
app.get('/healthz', (req, res) => res.status(200).send('Voice Brain Online 🟢'));

// -- Twilio Webhook (Voice Entry Point) --
app.post('/voice-answer', (req, res) => {
  // Signature Validation
  const signature = req.get('X-Twilio-Signature');
  const url = `${PUBLIC_BASE_URL}/voice-answer`;
    console.log('[DEBUG] PUBLIC_BASE_URL:', PUBLIC_BASE_URL);
  console.log('[DEBUG] Constructed URL:', url);
  console.log('[DEBUG] Signature:', signature);
  console.log('[DEBUG] Params:', params);
  const params = req.body;

  if (!twilio.validateRequest(TWILIO_AUTH_TOKEN, signature, url, params)) {
    console.error('[Security] Invalid Twilio Signature on /voice-answer');
    return res.status(403).send('Forbidden');
  }

  const relayUrl = `${PUBLIC_BASE_URL.replace('https', 'wss')}/relay`;
  console.log(`[Call Incoming] Validated. Handoff to: ${relayUrl}`);

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
    <Response>
      <Connect>
        <ConversationRelay 
          url="${relayUrl}" 
          welcomeGreeting="Thank you for calling Trade Line 24 7. How can I help?"
          transcriptionProvider="Deepgram"
          transcriptionLanguage="multi"
          speechModel="nova-3-general"
          ttsProvider="ElevenLabs"
          ttsLanguage="multi"
          interruptible="speech"
          preemptible="true" 
        />
      </Connect>
    </Response>`;

  res.type('text/xml').send(twiml);
});

// -- WebSocket Server (The Brain) --
const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

// Custom Upgrade Handling for Signature Validation
server.on('upgrade', (request, socket, head) => {
  const { url: requestUrl } = request;
  const fullUrl = `${PUBLIC_BASE_URL}${requestUrl}`;
  const signature = request.headers['x-twilio-signature'];

  // Parse query params from requestUrl for validation
  // ConversationRelay sends params in the query string
  const urlObj = new URL(fullUrl);
  const params = Object.fromEntries(urlObj.searchParams);

  if (!twilio.validateRequest(TWILIO_AUTH_TOKEN, signature, fullUrl, params)) {
    console.error('[Security] Invalid Twilio Signature on WebSocket upgrade');
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

wss.on('connection', (ws) => {
  console.log('[Connection] New Secure Call Connected');

  const session = {
    history: [
      { role: 'system', content: 'You are the TradeLine 24/7 AI receptionist. Be professional, concise (max 2 sentences), and helpful. Do not use markdown. Speak in the same language as the user.' },
    ],
    lang: 'en', // default
    abortController: null,
    heartbeat: null,
  };

  // Heartbeat
  session.heartbeat = setInterval(() => {
    if (ws.readyState === ws.OPEN) {
      ws.ping();
    } else {
      clearInterval(session.heartbeat);
    }
  }, 20000);

  ws.on('pong', () => {
    // Connection alive
  });

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data);

      if (msg.type === 'setup') {
        console.log(`[Setup] SID: ${msg.callSid}`);
      }

      if (msg.type === 'prompt') {
        const userText = msg.voicePrompt;
        const userLang = msg.lang || 'en';
        session.lang = userLang;

        if (!userText) return;

        console.log(`[User (${userLang})]: ${userText}`);
        session.history.push({ role: 'user', content: userText });

        // Cap history
        if (session.history.length > 20) {
          session.history = [session.history[0], ...session.history.slice(-19)];
        }

        // Abort previous in-flight
        if (session.abortController) {
          session.abortController.abort();
        }
        session.abortController = new AbortController();

        // 1.2s Dead Air Timer
        let fillerSent = false;
        const fillerTimer = setTimeout(() => {
          if (ws.readyState === ws.OPEN && !session.abortController.signal.aborted) {
            fillerSent = true;
            // Provide localized fillers if possible, for now simple english fallback or multi-lang aware
            const filler = userLang.startsWith('es') ? 'Un momento...' : 'One moment...';
            console.log(`[Filler]: ${filler}`);
            ws.send(JSON.stringify({
              type: 'text',
              token: filler,
              last: true,
              lang: userLang,
              interruptible: true,
              preemptible: true,
            }));
          }
        }, 1200);

        try {
          const start = Date.now();
          const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: session.history,
            max_tokens: 150,
            temperature: 0.6,
          }, { signal: session.abortController.signal });

          clearTimeout(fillerTimer);
          const latency = Date.now() - start;
          const aiText = completion.choices[0].message.content;

          if (session.abortController.signal.aborted) return;

          console.log(`[AI]: ${aiText} (${latency}ms)`);
          session.history.push({ role: 'assistant', content: aiText });

          if (ws.readyState === ws.OPEN) {
            // Note: If filler was sent, this is a new "last=true" message which effectively
            // sequences after the filler in Twilio's TTS queue.
            ws.send(JSON.stringify({
              type: 'text',
              token: aiText,
              last: true,
              lang: userLang,
              interruptible: true,
              preemptible: true,
            }));
          }
        } catch (openaiErr) {
          clearTimeout(fillerTimer);
          if (openaiErr.name === 'AbortError') {
            console.log('[Flow] OpenAI Request Aborted');
          } else {
            console.error('[Error] OpenAI:', openaiErr);
            // Fail safe
            const errorMsg = userLang.startsWith('es') ? 'Lo siento, no pude escuchar. ¿Puede repetir?' : 'I am sorry, I did not catch that. Could you please repeat?';
            if (ws.readyState === ws.OPEN) {
              ws.send(JSON.stringify({
                type: 'text',
                token: errorMsg,
                last: true,
                lang: userLang,
              }));
            }
          }
        }
      }

      if (msg.type === 'interrupt') {
        console.log('[Flow] Interrupted');
        if (session.abortController) {
          session.abortController.abort();
        }
      }

    } catch (err) {
      console.error('[Error] Msg Processing:', err);
    }
  });

  ws.on('close', () => {
    console.log('[Connection] Call Ended');
    clearInterval(session.heartbeat);
    if (session.abortController) {
      session.abortController.abort();
    }
  });
});

server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
