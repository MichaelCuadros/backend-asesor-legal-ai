import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import mongoose from 'mongoose';
import cookieParser from 'cookie-parser';
import authRoutes from './routes/auth.js';
import { requireAuth } from './middleware/auth.js';

const app = express();
const PORT = process.env.PORT || 3000;
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || 'http://localhost:5173';

app.use(cors({ origin: ALLOW_ORIGIN, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// Health
app.get('/health', (_req, res) => res.json({ ok: true }));

// Mongo
mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.MONGODB_DB || undefined })
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB error', err));

// Auth routes
app.use('/api/auth', authRoutes);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function writeSSE(res, dataObj) {
  res.write(`data: ${JSON.stringify(dataObj)}\n\n`);
}

// Chat (JWT protected)
app.post('/api/chat', requireAuth, async (req, res) => {
  try {
    const { messages = [], model = 'gpt-4o-mini' } = req.body || {};
    const useStream = 'stream' in req.query;

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });
    }
    if (!Array.isArray(messages)) {
      return res.status(400).json({ error: 'messages_must_be_array' });
    }

    if (!useStream) {
      const completion = await openai.chat.completions.create({
        model, messages, temperature: 0.7,
      });
      const text = completion.choices?.[0]?.message?.content ?? '(sin contenido)';
      return res.json({ content: text });
    }

    // Streaming SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const stream = await openai.chat.completions.create({
      model, messages, temperature: 0.7, stream: true,
    });

    let full = '';
    try {
      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta?.content || '';
        if (delta) {
          full += delta;
          writeSSE(res, { delta });
        }
      }
      writeSSE(res, { done: true, content: full });
      res.write('data: [DONE]\n\n');
      res.end();
    } catch (err) {
      console.error('stream error', err);
      writeSSE(res, { error: 'stream_error', message: String(err?.message || err) });
      res.end();
    }
  } catch (error) {
    console.error(error);
    if (!res.headersSent) res.status(500).json({ error: 'internal_error', message: String(error?.message || error) });
    else { try { res.end(); } catch {} }
  }
});

app.listen(PORT, () => console.log(`Server on http://localhost:${PORT}`));
