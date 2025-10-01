// src/index.js
import "dotenv/config";
import express from "express";
import cors from "cors";
import router from "./routes.js";

const app = express();

// ===== CORS =====
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || "https://kpi.bvx.com.vn";
app.use(cors({
  origin: ALLOW_ORIGIN,
  credentials: true,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "x-api-key", "authorization"]
}));
app.options("*", cors());

// ===== JSON body =====
app.use(express.json({ limit: "2mb" }));

// ===== API key check =====
app.use((req, res, next) => {
  if (req.method === "OPTIONS") return next();
  const required = process.env.API_KEY;
  if (!required) return next();
  const got = req.header("x-api-key");
  if (got !== required) {
    return res.status(401).json({ ok: false, error: "INVALID_API_KEY" });
  }
  next();
});

// ===== Healthcheck =====
app.get("/health", (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

// ===== Routes =====
app.use("/", router);

// ===== Start =====
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 BVX API listening on http://localhost:${PORT}`);
});
