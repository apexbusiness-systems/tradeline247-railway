require('dotenv').config();
const express = require('express');
const { createServer } = require('http');
const { WebSocketServer } = require('ws');
const OpenAI = require('openai');
const helmet = require('helmet');
const xss = require('xss-clean');

// -- Configuration --
const PORT = process.env.PORT || 8080;
const SYSTEM_PROMPT = "You are the TradeLine 24/7 AI receptionist. Be professional, concise (max 2 sentences), and helpful. Do not use markdown.";

// -- Safety Checks --
if (!process.env.OPENAI_API_KEY) {
  console.error('FATAL: OPENAI_API_KEY is missing.');
  process.exit(1);
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const app = express();

// -- Middleware --
app.use(helmet()); // Security Headers
app.use(xss());    // Sanitize Input
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// -- Health Check (Keep-Alive for Render) --
app.get('/', (req, res) => res.status(200).send('Voice Brain Online 🟢'));

// -- Twilio Webhook (Entry Point) --
app.post('/voice-answer', (req, res) => {
  const host = req.get('host');
  const isLocal = host.includes('localhost');
  const protocol = isLocal ? 'ws' : 'wss';
  const relayUrl = `${protocol}://${host}/relay`;

  console.log(`[Call Incoming] Handoff to: ${relayUrl}`);

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
    <Response>
      <Connect>
        <ConversationRelay url="${relayUrl}" 
                           welcomeGreeting="Thank you for calling Trade Line 24 7. How can I help?"
                           voice="en-US-Neural2-J" />
      </Connect>
    </Response>`;

  res.type('text/xml').send(twiml);
});

// -- WebSocket Server (The Brain) --
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/relay' });

wss.on('connection', (ws) => {
  console.log('[Connection] New Call Connected');

  const sessionHistory = [{ role: 'system', content: SYSTEM_PROMPT }];

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data);

      if (msg.type === 'setup') {
        console.log(`[Setup] SID: ${msg.callSid}`);
      } 

      if (msg.type === 'prompt') {
        const userText = msg.voicePrompt;
        if (!userText) return;

        console.log(`[User]: ${userText}`);
        sessionHistory.push({ role: 'user', content: userText });

        // Call OpenAI
        const start = Date.now();
        const completion = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: sessionHistory,
          max_tokens: 150,
          temperature: 0.6,
        });
        const latency = Date.now() - start;

        const aiText = completion.choices[0].message.content;
        console.log(`[AI]: ${aiText} (${latency}ms)`);

        sessionHistory.push({ role: 'assistant', content: aiText });

        // Reply to Twilio
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({
            type: 'text',
            token: msg.token,
            text: aiText,
            last: true
          }));
        }
      }
    } catch (err) {
      console.error('[Error] Msg Processing:', err);
    }
  });

  ws.on('close', () => console.log('[Connection] Call Ended'));
});

server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
