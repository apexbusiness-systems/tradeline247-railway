const express = require('express');
const twilio = require('twilio');

const app = express();

// CRITICAL: Trust Railway's proxy (fixes https detection)
app.set('trust proxy', 1);

// CRITICAL: Raw body needed for signature validation
app.use('/voice-answer', express.raw({ type: '*/*' }));

const validateTwilioRequest = (req, res, next) => {
  // Skip validation if explicitly disabled
  if (process.env.SKIP_TWILIO_VALIDATION === 'true') {
    console.log('[Security] Validation bypassed via env flag');
    return next();
  }

  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    console.error('[Security] TWILIO_AUTH_TOKEN not set');
    return res.status(500).send('Server misconfigured');
  }

  // Build the EXACT URL Twilio signed (use X-Forwarded headers)
  const protocol = req.get('X-Forwarded-Proto') || req.protocol;
  const host = req.get('X-Forwarded-Host') || req.get('Host');
  const fullUrl = `${protocol}://${host}${req.originalUrl}`;

  console.log('[Security] Validating URL:', fullUrl);

  // Parse body for validation
  const params = req.body ? 
    (typeof req.body === 'string' ? 
      Object.fromEntries(new URLSearchParams(req.body.toString())) : 
      req.body) : 
    {};

  const signature = req.get('X-Twilio-Signature');
  
  const isValid = twilio.validateRequest(
    authToken,
    signature,
    fullUrl,
    params
  );

  if (!isValid) {
    console.error('[Security] Invalid Twilio Signature on', req.path);
    console.error('[Security] Expected URL:', fullUrl);
    console.error('[Security] Signature:', signature);
    return res.status(403).send('Invalid signature');
  }

  // Re-parse body for route handlers
  if (typeof req.body === 'string' || Buffer.isBuffer(req.body)) {
    req.body = Object.fromEntries(new URLSearchParams(req.body.toString()));
  }

  next();
};

// Apply to voice routes
app.post('/voice-answer', validateTwilioRequest, (req, res) => {
  // Your TwiML response here
  const twiml = new twilio.twiml.VoiceResponse();
  twiml.say('Thank you for calling Trade Line 24 7. How can I help?');
  res.type('text/xml');
  res.send(twiml.toString());
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
