import 'dotenv/config';
import Fastify from 'fastify';
import fastifyFormBody from '@fastify/formbody';
import fastifyWebsocket from '@fastify/websocket';
import WebSocket from 'ws';
import twilio from 'twilio';
import nodemailer from 'nodemailer';

// -- Configuration --
const {
    PORT = 8080,
    OPENAI_API_KEY,
    TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN,
    DISPATCH_PHONE_NUMBER,
    EMAIL_TO,
    EMAIL_USER,
    EMAIL_PASS,
    EMAIL_SERVICE,
    PUBLIC_BASE_URL
} = process.env;

// Validate critical env vars
if (!OPENAI_API_KEY) {
    console.error('CRITICAL: OPENAI_API_KEY is missing');
    process.exit(1);
}

// Validate and normalize PUBLIC_BASE_URL
let PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL;
if (!PUBLIC_BASE_URL) {
    console.error('CRITICAL: PUBLIC_BASE_URL is missing');
    process.exit(1);
}
PUBLIC_BASE_URL = PUBLIC_BASE_URL.trim().replace(/\/$/, ''); // trim and remove trailing slash
if (!PUBLIC_BASE_URL.startsWith('http://') && !PUBLIC_BASE_URL.startsWith('https://')) {
    console.error('CRITICAL: PUBLIC_BASE_URL must start with http:// or https://');
    process.exit(1);
}
console.log(`[Config] PUBLIC_BASE_URL: ${PUBLIC_BASE_URL}`);

if (!TWILIO_AUTH_TOKEN) {
    console.warn('WARNING: TWILIO_AUTH_TOKEN is missing - signature validation will fail in production');
}

// -- Global State --
const sessionStore = new Map(); // CallSid -> { transcript: [], startTime: Date }
const callTokens = new Map(); // callSid -> token (short-lived, 5min expiry)

// -- Security Helpers --
import crypto from 'crypto';

function generateCallToken(callSid) {
    const token = crypto.randomBytes(16).toString('hex');
    callTokens.set(callSid, token);
    setTimeout(() => callTokens.delete(callSid), 300000); // 5min expiry
    return token;
}

function validateCallToken(callSid, token) {
    return callTokens.get(callSid) === token;
}

function validateTwilioSignature(url, params, signature) {
    if (process.env.SKIP_TWILIO_VALIDATION === 'true') {
        console.log('[Security] Twilio validation bypassed via env flag');
        return true;
    }
    if (!TWILIO_AUTH_TOKEN || !signature) {
        console.error('[Security] Missing TWILIO_AUTH_TOKEN or signature');
        return false;
    }
    try {
        return twilio.validateRequest(TWILIO_AUTH_TOKEN, signature, url, params);
    } catch (err) {
        console.error('[Security] Signature validation error:', err);
        return false;
    }
}

// -- Clients --
const app = Fastify({
    logger: true,
    trustProxy: true  // Critical for Railway proxy headers
});
const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
const mailTransport = nodemailer.createTransport({
    service: EMAIL_SERVICE || 'gmail', // Default to gmail if not specified, or use generic SMTP via env
    auth: {
        user: EMAIL_USER,
        pass: EMAIL_PASS
    }
});

// -- Plugins --
app.register(fastifyFormBody);
app.register(fastifyWebsocket);

// -- Constants & Tools --
const SYSTEM_INSTRUCTIONS = `You are the TradeLine 24/7 AI receptionist. 
Your goal is to answer questions, check availability, and book appointments.
Speak in a professional, warm, and concise manner.
Always use the provided tools for availability and booking.
If the user asks to speak to a human or if you cannot help, use the transfer_call tool.`;

const TOOLS = [
    {
        type: 'function',
        name: 'check_availability',
        description: 'Check available appointment slots for a given date.',
        parameters: {
            type: 'object',
            properties: {
                date: { type: 'string', description: 'Date to check availability for (e.g. 2024-05-20)' }
            },
            required: ['date']
        }
    },
    {
        type: 'function',
        name: 'book_appointment',
        description: 'Book an appointment for a specific time.',
        parameters: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Name of the customer' },
                time: { type: 'string', description: 'Time of the appointment' },
                phone: { type: 'string', description: 'Phone number of the customer' }
            },
            required: ['name', 'time', 'phone']
        }
    },
    {
        type: 'function',
        name: 'transfer_call',
        description: 'Transfer the call to a human agent immediately.',
        parameters: {
            type: 'object',
            properties: {
                reason: { type: 'string', description: 'Reason for transferring the call' }
            },
            required: ['reason']
        }
    }
];

// -- Routes --

// Health Check
app.get('/', async (req, reply) => {
    return { status: 'online', service: 'TradeLine 24/7 Voice Orchestrator' };
});

// Canonical voice webhook handler (with security + proper URL construction)
async function handleVoiceWebhook(request, reply) {
    // Twilio signature validation
    const signature = request.headers['x-twilio-signature'];
    const url = `${PUBLIC_BASE_URL}${request.url}`;
    const params = request.body || {};

    if (!validateTwilioSignature(url, params, signature)) {
        console.error('[Security] Invalid Twilio signature');
        return reply.code(403).send('Forbidden');
    }

    // Extract CallSid from Twilio payload
    const callSid = params.CallSid || 'UNKNOWN';
    console.log(`[Webhook] Incoming call: ${callSid}`);

    // Generate secure token for this call
    const token = generateCallToken(callSid);

    // Build secure WebSocket URL with token (use PUBLIC_BASE_URL as source of truth)
    const wssBase = PUBLIC_BASE_URL.replace(/^https:\/\//, 'wss://').replace(/^http:\/\//, 'ws://');
    const wsUrl = `${wssBase}/media-stream?token=${token}&callSid=${callSid}`;

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna-Neural">Hello, thank you for calling Trade Line 24 7. Connecting you now.</Say>
  <Connect>
    <Stream url="${wsUrl}" statusCallback="${PUBLIC_BASE_URL}/voice-status" statusCallbackMethod="POST" />
  </Connect>
</Response>`;

    reply
        .code(200)
        .header('Content-Type', 'text/xml')
        .send(twiml);
}

// Webhook routes (canonical + aliases for resilience)
app.post('/voice', handleVoiceWebhook);
app.post('/voice-answer', handleVoiceWebhook);
app.post('/', handleVoiceWebhook); // Fallback if Twilio points to root

// WebSocket Route (The Core Loop)
app.register(async (fastify) => {
    fastify.get('/media-stream', { websocket: true }, (connection, req) => {
        // Extract and validate query params (token security)
        const url = new URL(req.url, `http://${req.headers.host}`);
        const token = url.searchParams.get('token');
        const callSid = url.searchParams.get('callSid');

        // Validate token
        if (!callSid || !token || !validateCallToken(callSid, token)) {
            console.error('[Security] Invalid or missing WebSocket token');
            connection.socket.close(1008, 'Unauthorized');
            return;
        }

        console.log(`[Connection] Client connected to /media-stream (CallSid: ${callSid})`);

        let streamSid = null;
        let openAiWs = null;

        // Helper to send to OpenAI if open
        const sendToOpenAI = (data) => {
            if (openAiWs && openAiWs.readyState === WebSocket.OPEN) {
                openAiWs.send(JSON.stringify(data));
            }
        };

        // Helper to run tools
        const executeTool = async (name, args) => {
            console.log(`[Tool] Executing ${name} with props:`, args);

            if (name === 'check_availability') {
                return { slots: ['2:00 PM', '4:00 PM'] };
            }
            if (name === 'book_appointment') {
                return { status: 'success', confirmation: 'TL-992', message: 'Appointment booked.' };
            }
            if (name === 'transfer_call') {
                if (!callSid) return { status: 'error', message: 'No CallSid found' };
                try {
                    console.log(`[Dispatch] Transferring Call ${callSid} to ${DISPATCH_PHONE_NUMBER}`);
                    await twilioClient.calls(callSid).update({
                        twiml: `<Response>
                      <Say>Please hold while I transfer you to a specialist.</Say>
                      <Dial>${DISPATCH_PHONE_NUMBER}</Dial>
                    </Response>`
                    });
                    return { status: 'success', message: 'Call transferred' };
                } catch (e) {
                    console.error('[Dispatch] Transfer failed:', e);
                    return { status: 'error', message: 'Transfer failed' };
                }
            }
            return { status: 'error', message: 'Unknown tool' };
        };

        // Initialize OpenAI Realtime Connection
        const initOpenAI = () => {
            openAiWs = new WebSocket('wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01', {
                headers: {
                    Authorization: `Bearer ${OPENAI_API_KEY}`,
                    'OpenAI-Beta': 'realtime=v1',
                }
            });

            openAiWs.on('open', () => {
                console.log('[OpenAI] Connected to Realtime API');
                // Session Configuration
                sendToOpenAI({
                    type: 'session.update',
                    session: {
                        turn_detection: { type: 'server_vad' },
                        input_audio_format: 'g711_ulaw',
                        output_audio_format: 'g711_ulaw',
                        voice: 'shimmer',
                        instructions: SYSTEM_INSTRUCTIONS,
                        modalities: ["text", "audio"],
                        temperature: 0.7,
                        tools: TOOLS,
                    }
                });
            });

            openAiWs.on('message', (data) => {
                try {
                    const response = JSON.parse(data);

                    // 1. Audio Relay (AI -> Twilio)
                    if (response.type === 'response.audio.delta' && response.delta) {
                        connection.socket.send(JSON.stringify({
                            event: 'media',
                            streamSid: streamSid,
                            media: { payload: response.delta }
                        }));
                    }

                    // 2. User Transcript
                    if (response.type === 'conversation.item.input_audio_transcription.completed') {
                        const text = response.transcript;
                        if (callSid && sessionStore.has(callSid)) {
                            console.log(`[Transcript] User: ${text}`);
                            sessionStore.get(callSid).transcript.push({ role: 'user', text, timestamp: new Date() });
                        }
                    }

                    // 3. AI Transcript
                    if (response.type === 'response.audio_transcript.done') {
                        const text = response.transcript;
                        if (callSid && sessionStore.has(callSid)) {
                            console.log(`[Transcript] AI: ${text}`);
                            sessionStore.get(callSid).transcript.push({ role: 'assistant', text, timestamp: new Date() });
                        }
                    }

                    // 4. Tool Calling
                    if (response.type === 'response.function_call_arguments.done') {
                        const { call_id, name, arguments: argsStr } = response;
                        const args = JSON.parse(argsStr);

                        executeTool(name, args).then(output => {
                            sendToOpenAI({
                                type: 'conversation.item.create',
                                item: {
                                    type: 'function_call_output',
                                    call_id: call_id,
                                    output: JSON.stringify(output)
                                }
                            });
                            // Prompt the model to respond to the tool output
                            sendToOpenAI({ type: 'response.create' });
                        });
                    }

                } catch (e) {
                    console.error('[OpenAI] Parse Error:', e);
                }
            });

            openAiWs.on('error', (e) => console.error('[OpenAI] Error:', e));
            openAiWs.on('close', () => console.log('[OpenAI] Disconnected'));
        };

        // Handle Twilio Messages
        connection.socket.on('message', (message) => {
            try {
                const msg = JSON.parse(message);

                switch (msg.event) {
                    case 'start':
                        streamSid = msg.start.streamSid;
                        callSid = msg.start.callSid;
                        console.log(`[Twilio] Stream Started. Sid: ${streamSid}, CallSid: ${callSid}`);
                        // Init Session Memory
                        sessionStore.set(callSid, { transcript: [], startTime: new Date() });
                        // Start AI
                        initOpenAI();
                        break;

                    case 'media':
                        if (openAiWs && openAiWs.readyState === WebSocket.OPEN) {
                            sendToOpenAI({
                                type: 'input_audio_buffer.append',
                                audio: msg.media.payload
                            });
                        }
                        break;

                    case 'stop':
                        console.log(`[Twilio] Stream Stopped: ${streamSid}`);
                        if (openAiWs) openAiWs.close();
                        break;

                    case 'mark':
                        // Logic for handling marks/interruption acknowledgements could go here
                        break;
                }
            } catch (e) {
                console.error('[Twilio] Message Error:', e);
            }
        });

        connection.socket.on('close', () => {
            console.log('[Twilio] Connection Closed');
            if (openAiWs) openAiWs.close();
        });

    });
});

// Webhook: Post-Call Status (with signature validation)
app.post('/voice-status', async (req, reply) => {
    // Validate Twilio signature
    const signature = req.headers['x-twilio-signature'];
    const url = `${PUBLIC_BASE_URL}/voice-status`;
    const params = req.body || {};

    if (!validateTwilioSignature(url, params, signature)) {
        console.error('[Security] Invalid Twilio signature on status callback');
        return reply.code(403).send('Forbidden');
    }

    const { CallSid, CallStatus } = req.body;
    console.log(`[Status] ${CallSid} -> ${CallStatus}`);

    const FINISHED_STATUSES = ['completed', 'failed', 'busy', 'no-answer', 'canceled'];
    if (FINISHED_STATUSES.includes(CallStatus)) {
        if (sessionStore.has(CallSid)) {
            const session = sessionStore.get(CallSid);
            const transcriptLines = session.transcript
                .map(t => `[${t.role.toUpperCase()}] ${t.text}`)
                .join('\n');

            console.log(`[Cleanup] Sending transcript for ${CallSid}...`);

            // Emailing
            if (EMAIL_TO && EMAIL_USER) {
                try {
                    await mailTransport.sendMail({
                        from: EMAIL_USER,
                        to: EMAIL_TO,
                        subject: `TradeLine 24/7 Call Summary: ${CallSid}`,
                        text: `Call Time: ${session.startTime}\nStatus: ${CallStatus}\n\n-- TRANSCRIPT --\n\n${transcriptLines}`
                    });
                    console.log(`[Email] Transcript sent to ${EMAIL_TO}`);
                } catch (mailErr) {
                    console.error('[Email] Failed to send:', mailErr);
                }
            } else {
                console.warn('[Email] Skipping email (Missing EMAIL_TO or EMAIL_USER)');
            }

            // Clear memory
            sessionStore.delete(CallSid);
        }
    }

    return { status: 'ok' };
});

// -- Start Server --
const start = async () => {
    try {
        const address = await app.listen({ port: PORT, host: '0.0.0.0' });
        console.log(`Server listening at ${address}`);
    } catch (err) {
        app.log.error(err);
        process.exit(1);
    }
};

start();
