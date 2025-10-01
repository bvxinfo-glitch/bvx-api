// src/index.js
import "dotenv/config";
import express from "express";
import cors from "cors";
import pkg from "pg";

const { Pool } = pkg;

// ===== ENV =====
const {
  PORT = 8080,
  API_KEY,                          // lấy từ Secret
  PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE,  // PGUSER=kpi_user, PGDATABASE=kpi_db
  ALLOW_ORIGIN = "https://kpi.bvx.com.vn"
} = process.env;

// ===== DB Pool =====
const pool = new Pool({
  host: PGHOST,
  port: PGPORT ? Number(PGPORT) : 5432,
  user: PGUSER,                     // kpi_user
  password: String(PGPASSWORD || ""),
  database: PGDATABASE,             // kpi_db
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

// ===== App =====
const app = express();

// ===== CORS =====
app.use(cors({
  origin: ALLOW_ORIGIN,             // cần thì tạm đặt "*" để test nhanh
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
  // Nếu bạn đã set API_KEY qua Secret Manager thì bật kiểm tra này
  if (API_KEY && req.header("x-api-key") !== API_KEY) {
    return res.status(401).json({ ok: false, error: "INVALID_API_KEY" });
  }
  next();
});

// ===== Helpers =====
const up = (v) => (v || "").toString().trim().toUpperCase();

// DÙNG cột name_code (đã proven OK trên môi trường của bạn)
const SQL_GET_USER = `
  SELECT *
  FROM public."KPI_Users"
  WHERE upper(name_code) = upper($1)
  LIMIT 1
`;

// ===== Routes =====
app.get("/health", (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

// whoAmI — dùng cho màn login
app.post("/whoAmI", async (req, res) => {
  try {
    const manv = up(req.body?.manv);
    if (!manv) return res.status(400).json({ ok: false, error: "manv required" });

    const { rows } = await pool.query(SQL_GET_USER, [manv]);
    if (rows.length === 0) return res.status(404).json({ ok: false, error: "User not found" });

    // trả nguyên row; nếu muốn map field FE thì bổ sung mapper sau
    res.json({ ok: true, user: rows[0] });
  } catch (e) {
    console.error("whoAmI error:", e);
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// Enrich 1 user
app.post("/users/enrich", async (req, res) => {
  try {
    const manv = up(req.body?.manv);
    if (!manv) return res.status(400).json({ ok: false, error: "manv required" });

    const { rows } = await pool.query(SQL_GET_USER, [manv]);
    if (rows.length === 0) return res.status(404).json({ ok: false, error: "User not found" });

    res.json({ ok: true, user: rows[0] });
  } catch (e) {
    console.error("enrich error:", e);
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// Enrich batch
app.post("/users/enrichBatch", async (req, res) => {
  try {
    const manvs = (req.body?.manvs || []).map(up);
    if (!manvs.length) return res.json({ ok: true, users: {} });

    const q = 'SELECT * FROM public."KPI_Users" WHERE upper(name_code) = ANY($1::text[])';
    const { rows } = await pool.query(q, [manvs]);
    const map = {};
    rows.forEach(r => { map[r.name_code?.toUpperCase?.() || r.name_code] = r; });
    res.json({ ok: true, users: map });
  } catch (e) {
    console.error("enrichBatch error:", e);
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// Alias: /enrichUsers => enrich hoặc enrichBatch
app.post("/enrichUsers", (req, _res, next) => {
  if (Array.isArray(req.body?.manvs)) {
    req.url = "/users/enrichBatch";
  } else {
    req.url = "/users/enrich";
  }
  next();
}, app._router);

// ===== Start =====
app.listen(PORT, () => {
  console.log(`🚀 BVX API listening on http://localhost:${PORT}`);
});
