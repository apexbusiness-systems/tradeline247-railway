# TradeLine Voice Server

Production-Grade Node.js Voice Server bridging Twilio ConversationRelay and OpenAI.

## Features
- **WebSocket Orchestration**: Handles bi-directional audio streams.
- **OpenAI Integration**: Uses `gpt-4o-mini` for conversational intelligence.
- **Security**: Implements `helmet` and `xss-clean`.
- **Production Ready**: Configured for Railway and Render deployments.

## Setup

1. **Environment Variables**
   Ensure `OPENAI_API_KEY` is set in your environment.

2. **Installation**
   ```bash
   npm install
   ```

3. **Running locally**
   ```bash
   npm run dev
   ```

## Deployment
- **Railway**: Recommended for reliability.
- **Render**: Good for free tier experiments (includes Keep-Alive endpoint).
