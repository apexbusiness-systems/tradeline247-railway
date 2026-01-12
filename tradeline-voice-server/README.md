# TradeLine Voice Server

Production-Grade Node.js Voice Server bridging Twilio ConversationRelay and OpenAI.

## Environment Variables
Ensure these variables are set in your environment (Railway/Render):

- `OPENAI_API_KEY`: Your OpenAI API Key.
- `TWILIO_AUTH_TOKEN`: Your Twilio Auth Token (for signature validation).
- `PUBLIC_BASE_URL`: The public URL of your service (e.g., `https://your-app.up.railway.app`). Do not include trailing slash.
- `PORT`: (Optional) Defaults to 8080.

## Setup

1. **Installation**
   ```bash
   npm install
   ```

2. **Running locally**
   ```bash
   npm run dev
   ```

3. **Linting**
   ```bash
   npm run lint
   ```

## Deployment
- **Railway**: Recommended for reliability.
- **Render**: Good for free tier experiments (includes Keep-Alive endpoint).

## Twilio Setup
- **Voice URL**: Point your Twilio Phone Number's Voice URL to `https://<PUBLIC_BASE_URL>/voice-answer`.
