// server.js (o index.js)
import "dotenv/config";
import express from "express";
import cors from "cors";
import OpenAI from "openai";
import mongoose from "mongoose";
import cookieParser from "cookie-parser";
import authRoutes from "./routes/auth.js";
import { requireAuth } from "./middleware/auth.js";

const app = express();
const PORT = process.env.PORT || 3000;

// ===== CORS =====
/**
 * Orígenes permitidos:
 * - prod: tu frontend en Vercel
 * - dev: localhost (vite/next)
 * Agrega/quita aquí según necesites.
 */
const CORS_WHITELIST = [
  "https://asesor-legal-ai.vercel.app",
  "https://asesor-legal-ai.vercel.app/",
  "http://localhost:5173",
  "http://localhost:3000",
].filter(Boolean);

const corsOptions = {
  origin(origin, cb) {
    // Permite llamadas sin Origin (curl, health checks, monitoreos)
    if (!origin) return cb(null, true);
    if (CORS_WHITELIST.includes(origin)) return cb(null, true);
    return cb(new Error(`Not allowed by CORS: ${origin}`));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  maxAge: 600, // cache preflight 10 min
};

// (opcional) log de origen para depuración
app.use((req, _res, next) => {
  if (process.env.NODE_ENV !== "production") {
    console.log(
      "Origin:",
      req.headers.origin || "(no-origin)",
      req.method,
      req.path
    );
  }
  next();
});

app.use(cors(corsOptions));
// Maneja preflights explícitos (útil detrás de proxies/CDN)
app.options("*", cors(corsOptions));

// ===== Middlewares base =====
app.set("trust proxy", 1); // Render/Proxies
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

// ===== Healthcheck =====
app.get("/health", (_req, res) => res.json({ ok: true }));

// ===== MongoDB =====
const mongoUri = process.env.MONGODB_URI;
const mongoDbName = process.env.MONGODB_DB || undefined;

if (!mongoUri) {
  console.error("❌ Missing MONGODB_URI in env");
} else {
  mongoose
    .connect(mongoUri, { dbName: mongoDbName })
    .then(() => console.log("✅ MongoDB connected"))
    .catch((err) => console.error("❌ MongoDB error", err));
}

// ===== Auth routes =====
app.use("/api/auth", authRoutes);

// ===== OpenAI Chat (protegido con JWT) =====
const openaiApiKey = process.env.OPENAI_API_KEY;
const openai = openaiApiKey ? new OpenAI({ apiKey: openaiApiKey }) : null;

function writeSSE(res, dataObj) {
  res.write(`data: ${JSON.stringify(dataObj)}\n\n`);
}

app.post("/api/chat", requireAuth, async (req, res) => {
  try {
    const { messages = [], model = "gpt-4o-mini" } = req.body || {};
    const useStream = "stream" in req.query;

    if (!openai) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    }
    if (!Array.isArray(messages)) {
      return res.status(400).json({ error: "messages_must_be_array" });
    }

    if (!useStream) {
      const completion = await openai.chat.completions.create({
        model,
        messages,
        temperature: 0.7,
      });
      const text =
        completion.choices?.[0]?.message?.content ?? "(sin contenido)";
      return res.json({ content: text });
    }

    // Streaming SSE
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    // Cabeceras CORS para SSE (por si algún proxy recorta)
    const origin = req.headers.origin;
    if (origin && CORS_WHITELIST.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    res.flushHeaders?.();

    const stream = await openai.chat.completions.create({
      model,
      messages,
      temperature: 0.7,
      stream: true,
    });

    let full = "";
    try {
      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta?.content || "";
        if (delta) {
          full += delta;
          writeSSE(res, { delta });
        }
      }
      writeSSE(res, { done: true, content: full });
      res.write("data: [DONE]\n\n");
      res.end();
    } catch (err) {
      console.error("stream error", err);
      writeSSE(res, {
        error: "stream_error",
        message: String(err?.message || err),
      });
      res.end();
    }
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      res
        .status(500)
        .json({
          error: "internal_error",
          message: String(error?.message || error),
        });
    } else {
      try {
        res.end();
      } catch {}
    }
  }
});

// ===== Start =====
app.listen(PORT, () => {
  console.log(`🚀 Server on http://localhost:${PORT}`);
});
