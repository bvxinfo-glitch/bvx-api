// src/index.js
import "dotenv/config";
import express from "express";
import cors from "cors";
import pkg from "pg";

const { Pool } = pkg;

// ===== ENV =====
const {
  PORT = 8080,
  API_KEY, // lấy từ Secret
  PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE, // PGUSER=kpi_user, PGDATABASE=kpi_db
  ALLOW_ORIGIN = "https://kpi.bvx.com.vn"
} = process.env;

// ===== DB Pool =====
const pool = new Pool({
  host: PGHOST,
  port: PGPORT ? Number(PGPORT) : 5432,
  user: PGUSER, // kpi_user
  password: String(PGPASSWORD || ""),
  database: PGDATABASE, // kpi_db
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

// ===== App =====
const app = express();

// ===== CORS =====
app.use(
  cors({
    origin: ALLOW_ORIGIN, // cần thì có thể tạm đặt "*" để test nhanh
    credentials: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "x-api-key", "authorization"]
  })
);
app.options("*", cors());

// ===== JSON body =====
app.use(express.json({ limit: "2mb" }));

// ===== API key check =====
app.use((req, res, next) => {
  if (req.method === "OPTIONS") return next();
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

// ===== Health =====
app.all("/health", (_req, res) => {
  res.json({ ok: true, ts: Date.now(), rev: process.env.K_REVISION || "local" });
});

// ===== Init (FE bootstrap) =====
const getInitHandler = (_req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  res.json({
    ok: true,
    init: {
      today,
      userRole: "viewer",
      featureFlags: ["kpi-v1"],
      version: 1
    }
  });
};
app.get("/getInitParams", getInitHandler);
app.post("/getInitParams", getInitHandler);

// ===== Routes =====
// health + logout chấp nhận mọi method để tránh nhầm GET/POST/OPTIONS
app.all("/health", (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

app.all("/logout", (_req, res) => {
  // không có session server-side, chỉ trả OK cho FE tự xoá localStorage
  res.json({ ok: true });
});

// ===== whoAmI — dùng cho màn login (lấy thông tin user theo mã NV) =====
app.post("/whoAmI", async (req, res) => {
  try {
    const manv = up(req.body?.manv);
    if (!manv) return res.status(400).json({ ok: false, error: "manv required" });

    const { rows } = await pool.query(SQL_GET_USER, [manv]);
    if (rows.length === 0) return res.status(404).json({ ok: false, error: "User not found" });

    const user = { ...rows[0], name: rows[0].full_name };
    res.json({ ok: true, user });
  } catch (e) {
    console.error("whoAmI error:", e);
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// ====== PLAN / ROUNDS ======
const SQL_GET_PLAN_FOR_USER = `
  SELECT
    id,
    ma_vong   AS vong,
    bien_so   AS plate,
    gio_di    AS start_time,
    gio_ve    AS end_time,
    NULL::text AS route,
    ngay_txt  AS date,
    manv
  FROM public.rounds
  WHERE upper(manv) = upper($1) AND ngay_txt = $2
  ORDER BY gio_di NULLS LAST, id
`;

// Hỗ trợ cả GET/POST + nhận tham số từ body hoặc query
app.all(
  ["/getPlanForUser", "/plan/get", "/planForUser", "/getRoundsForUser"],
  async (req, res) => {
    try {
      const manv = up(req.body?.manv || req.query?.manv);
      let date = (req.body?.date || req.query?.date || "").toString().slice(0, 10);
      if (!date) date = new Date().toISOString().slice(0, 10);

      if (!manv) return res.status(400).json({ ok: false, error: "manv_required" });

      const { rows } = await pool.query(SQL_GET_PLAN_FOR_USER, [manv, date]);
      return res.json({ ok: true, rounds: rows, total: rows.length });
    } catch (e) {
      console.error("getPlanForUser error:", e);
      return res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  }
);

// ====== LOGOUT (UI cần ping để reset state client) ======
app.all(["/logout", "/signout"], (_req, res) => {
  // Không có session server-side nên chỉ trả OK cho FE tự xoá localStorage
  res.json({ ok: true });
});

// ===== Helpers dùng lại =====
const isYes = (v) => String(v || "").trim().toUpperCase().startsWith("Y");
const toRoleLevel = (txt) => {
  const t = String(txt || "").toLowerCase();
  if (t.includes("admin")) return 90;
  if (t.includes("manager") || t.includes("lead") || t.includes("trưởng")) return 50;
  return 10; // mặc định employee
};

// ===== checkUserAuth — xác thực PIN =====
app.post("/checkUserAuth", async (req, res) => {
  try {
    const manv = up(req.body?.manv);
    const pin = (req.body?.pin ?? "").toString().trim();

    if (!manv) return res.status(400).json({ ok: false, error: "manv required" });
    if (!pin) return res.status(400).json({ ok: false, error: "pin required" });

    const { rows } = await pool.query(SQL_GET_USER, [manv]);
    if (!rows.length) return res.status(404).json({ ok: false, error: "NOT_FOUND" });

    const u = rows[0];

    // active = 'Y...'
    const activeTxt = (u.active ?? "").toString().trim().toUpperCase();
    if (activeTxt && !activeTxt.startsWith("Y")) {
      return res.json({ ok: false, error: "INACTIVE" });
    }

    // PIN đang lưu dạng plain ở cột "pin" (nếu tên cột khác thì chỉnh ở đây)
    if (!u.pin || String(u.pin) !== pin) {
      return res.json({ ok: false, error: "INVALID_PIN" });
    }

    // Hạn PIN (nếu có)
    if (u.pin_expires_at && !isNaN(Date.parse(u.pin_expires_at))) {
      if (new Date(u.pin_expires_at) < new Date()) {
        return res.json({ ok: false, error: "PIN_EXPIRED" });
      }
    }

    return res.json({ ok: true, user: { ...u, name: u.full_name } });
  } catch (e) {
    console.error("checkUserAuth error:", e);
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// ===== SQL phụ trợ cho list users (lấy scope) =====
const SQL_SELECT_USER_BY_MANV = `
  SELECT "scopeView" AS scope_view
  FROM public."KPI_Users"
  WHERE upper(name_code) = upper($1)
  LIMIT 1
`;

// ===== SQL list users active =====
const SQL_LIST_USERS = `
  SELECT
    name_code      AS manv,
    full_name      AS full_name,
    role           AS role,
    "roleLevel"    AS role_level_txt,
    "canApprove"   AS can_approve_txt,
    "canAdjust"    AS can_adjust_txt,
    team           AS team_main,
    "scopeView"    AS scope_view,
    active         AS active_txt
  FROM public."KPI_Users"
  WHERE upper(coalesce(active, '')) LIKE 'Y%'
  ORDER BY name_code
  LIMIT 500
`;

async function listUsersHandler(req, res) {
  try {
    const body = req.body || {};
    const meManv = String(body.manv || "").trim().toUpperCase();

    const { rows } = await pool.query(SQL_LIST_USERS);
    let items = rows.map((r) => ({
      manv: r.manv,
      name: r.full_name, // FE dùng "name", vẫn giữ "full_name" cho tương thích
      full_name: r.full_name,
      role: r.role,
      role_level: toRoleLevel(r.role_level_txt),
      can_approve: isYes(r.can_approve_txt),
      can_adjust: isYes(r.can_adjust_txt),
      team_main: r.team_main,
      scope_view: r.scope_view,
      active: isYes(r.active_txt)
    }));

    // Nếu endpoint *InScope thì lọc theo scopeView của người gọi (meManv)
    const path = req.path.toLowerCase();
    const wantScope = path.includes("inscope");

    if (wantScope && meManv) {
      const me = await pool.query(SQL_SELECT_USER_BY_MANV, [meManv]);
      const scopeStr = String(me.rows?.[0]?.scope_view || "");
      const scopeArr = scopeStr.toUpperCase().split(/[,;|\s]+/).filter(Boolean);
      if (scopeArr.length) {
        items = items.filter((it) => {
          const t = String(it.team_main || "").toUpperCase();
          return !t || scopeArr.includes(t);
        });
      }
    }

    res.json({ ok: true, items, total: items.length });
  } catch (err) {
    console.error("listUsersHandler error:", err);
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
}

// Gắn nhiều alias để khớp FE
app.post(
  [
    "/users/list",
    "/users/listInScope",
    "/listUsers",
    "/listUsersInScope",
    "/getUsers",
    "/users",
    "/user/list",
    "/user/search"
  ],
  listUsersHandler
);

// ===== Enrich 1 user =====
app.post("/users/enrich", async (req, res) => {
  try {
    const manv = up(req.body?.manv);
    if (!manv) return res.status(400).json({ ok: false, error: "manv required" });

    const { rows } = await pool.query(SQL_GET_USER, [manv]);
    if (rows.length === 0) return res.status(404).json({ ok: false, error: "User not found" });

    const user = { ...rows[0], name: rows[0].full_name };
    res.json({ ok: true, user });
  } catch (e) {
    console.error("enrich error:", e);
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// ===== Enrich batch =====
app.post("/users/enrichBatch", async (req, res) => {
  try {
    const manvs = (req.body?.manvs || []).map(up);
    if (!manvs.length) return res.json({ ok: true, users: {} });

    const q =
      'SELECT * FROM public."KPI_Users" WHERE upper(name_code) = ANY($1::text[])';
    const { rows } = await pool.query(q, [manvs]);
    const map = {};
    rows.forEach((r) => {
      map[r.name_code?.toUpperCase?.() || r.name_code] = {
        ...r,
        name: r.full_name
      };
    });
    res.json({ ok: true, users: map });
  } catch (e) {
    console.error("enrichBatch error:", e);
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// ===== Alias: /enrichUsers => enrich hoặc enrichBatch =====
app.post(
  "/enrichUsers",
  (req, _res, next) => {
    if (Array.isArray(req.body?.manvs)) {
      req.url = "/users/enrichBatch";
    } else {
      req.url = "/users/enrich";
    }
    next();
  },
  app._router
);

// ===== Start =====
app.listen(PORT, () => {
  console.log(`🚀 BVX API listening on http://localhost:${PORT}`);
});
