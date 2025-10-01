// src/routes.js
import express from "express";
import { getPool } from "./db.js";
import { WhoAmISchema, RoundsSchema, CriteriaTripSchema } from "./validators.js";

const router = express.Router();

/* ================== HELPERS ================== */
const isYes = (v) => String(v || "").trim().toUpperCase().startsWith("Y");
const toRoleLevel = (txt) => {
  const t = String(txt || "").toLowerCase();
  if (t.includes("admin")) return 90;
  if (t.includes("manager") || t.includes("lead") || t.includes("trưởng")) return 50;
  return 10; // mặc định employee
};

function mapUserRow(u) {
  return {
    manv: u.manv,
    name: u.full_name,
    full_name: u.full_name,
    role: u.role,
    role_level: u.role_level_txt,
    roleLevel: toRoleLevel(u.role_level_txt),
    can_approve: isYes(u.can_approve_txt),
    canApprove: isYes(u.can_approve_txt),
    can_adjust: isYes(u.can_adjust_txt),
    canAdjust: isYes(u.can_adjust_txt),
    team_main: u.team_main,
    teamMain: u.team_main,
    scope_view: u.scope_view,
    scope_approve: u.scope_approve,
    scope_adjust: u.scope_adjust,
    device_id: u.device_id || null,
    active: isYes(u.active_txt),
    pin_expires_at: u.pin_expires_at || null,
    dept_code: u.dept_code || null,
    id: u.id_txt || null,
    pin_hash: u.pin_hash || null,
    pin_salt: u.pin_salt || null,
    created_at: u.created_at || null,
    updated_at: u.updated_at || null,
  };
}

// Câu SQL chuẩn để đọc user
const SQL_SELECT_USER_BY_MANV = `
  SELECT
    u.name_code      AS manv,
    u.full_name      AS full_name,
    u.role           AS role,
    u."roleLevel"    AS role_level_txt,
    u."canApprove"   AS can_approve_txt,
    u."canAdjust"    AS can_adjust_txt,
    u.team           AS team_main,
    u."scopeView"    AS scope_view,
    u."scopeApprove" AS scope_approve,
    u."scopeAdjust"  AS scope_adjust,
    u."deviceId"     AS device_id,
    u.active         AS active_txt,
    u.pin            AS pin_plain,
    u.pin_expires_at AS pin_expires_at,
    u.dept_code      AS dept_code,
    u.id             AS id_txt,
    u.pin_hash       AS pin_hash,
    u.pin_salt       AS pin_salt,
    u.created_at     AS created_at,
    u.updated_at     AS updated_at
  FROM public."KPI_Users" u
  WHERE upper(u.name_code) = upper($1)
  LIMIT 1
`;

/* ================== INIT ================== */
router.post("/getInitParams", async (_req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  res.json({ ok: true, init: { today, userRole: "viewer", featureFlags: ["kpi-v1"], version: 1 }});
});

/* ================== AUTH ================== */
router.post("/whoAmI", async (req, res) => {
  try {
    const { manv, pin } = WhoAmISchema.parse(req.body ?? {});
    const pool = await getPool();
    const { rows } = await pool.query(SQL_SELECT_USER_BY_MANV, [manv]);
    if (!rows.length) return res.json({ ok:true, user:{ notFound:true, msg:"Không tìm thấy Mã NV." } });
    const r = rows[0];
    if (!isYes(r.active_txt)) return res.json({ ok:true, user:{ notActive:true, msg:"Tài khoản chưa kích hoạt." } });
    if (pin && r.pin_plain && String(pin) !== String(r.pin_plain)) {
      return res.json({ ok:true, user:{ invalidPin:true, msg:"PIN không đúng." } });
    }
    return res.json({ ok:true, user: mapUserRow(r) });
  } catch (err) {
    console.error("whoAmI error:", err);
    res.status(400).json({ ok:false, error:String(err.message||err) });
  }
});

router.post("/checkUserAuth", async (req, res) => {
  try {
    const parsed = WhoAmISchema.extend({
      pin: WhoAmISchema.shape.pin.refine(v => !!v, "Required")
    }).parse(req.body ?? {});
    const { manv, pin } = parsed;
    const pool = await getPool();
    const { rows } = await pool.query(SQL_SELECT_USER_BY_MANV, [manv]);
    if (!rows.length) return res.json({ ok:false, error:"NOT_FOUND" });
    const r = rows[0];
    if (!isYes(r.active_txt)) return res.json({ ok:false, error:"INACTIVE" });
    if (!r.pin_plain || String(r.pin_plain) !== String(pin)) return res.json({ ok:false, error:"INVALID_PIN" });
    if (r.pin_expires_at && !isNaN(Date.parse(r.pin_expires_at))) {
      if (new Date(r.pin_expires_at) < new Date()) return res.json({ ok:false, error:"PIN_EXPIRED" });
    }
    return res.json({ ok:true, user: mapUserRow(r) });
  } catch (err) {
    console.error("checkUserAuth error:", err);
    res.status(400).json({ ok:false, error:String(err.message||err) });
  }
});

/* =============== USERS alias =============== */
router.post([
  "/users/list","/listUsers","/getUsers","/listUsersInScope",
  "/users/query","/users/search","/users",
  "/user/list","/user/query","/user/search","/user"
], async (req,res) => {
  try {
    const b = req.body||{};
    const meManv = String(b.manv||"").toUpperCase();
    const pool = await getPool();
    const q = `
      SELECT u.name_code AS manv, u.full_name, u.role, u."roleLevel" AS role_level_txt,
             u."canApprove" AS can_approve_txt, u."canAdjust" AS can_adjust_txt,
             u.team AS team_main, u."scopeView" AS scope_view, u.active AS active_txt
      FROM public."KPI_Users" u
      WHERE upper(coalesce(u.active,'')) LIKE 'Y%'
      ORDER BY u.name_code
      LIMIT 500
    `;
    const { rows } = await pool.query(q);
    let items = rows.map(r => ({
      manv:r.manv, full_name:r.full_name, role:r.role,
      role_level:toRoleLevel(r.role_level_txt),
      can_approve:isYes(r.can_approve_txt),
      can_adjust:isYes(r.can_adjust_txt),
      team_main:r.team_main, scope_view:r.scope_view,
      active:isYes(r.active_txt)
    }));
    if (req.path.endsWith("listUsersInScope") && meManv) {
      const meSql = `SELECT u."scopeView" AS scope_view FROM public."KPI_Users" u
                     WHERE upper(u.name_code)=upper($1) LIMIT 1`;
      const r = await pool.query(meSql,[meManv]);
      const scopeArr = String(r.rows?.[0]?.scope_view||"").toUpperCase().split(/[,;|\s]+/).filter(Boolean);
      if (scopeArr.length) items = items.filter(it=>{
        const t=String(it.team_main||"").toUpperCase();
        return !t || scopeArr.includes(t);
      });
    }
    res.json({ ok:true, items, total:items.length });
  } catch(err){
    console.error("usersListHandler error:",err);
    res.status(500).json({ ok:false, error:String(err.message||err) });
  }
});

/* ================== ROUNDS ================== */
router.post("/getRoundsForUser", async (req, res) => {
  try {
    const { manv, date } = RoundsSchema.parse(req.body ?? {});
    const pool = await getPool();
    const { rows } = await pool.query(
      `SELECT id, ma_vong AS vong, bien_so AS plate, gio_di AS start_time,
              gio_ve AS end_time, NULL::text AS route
       FROM public.rounds
       WHERE upper(manv) = upper($1) AND ngay_txt = $2
       ORDER BY gio_di NULLS LAST, id`,
      [manv.toUpperCase(), date]
    );
    res.json({ ok:true, rounds: rows });
  } catch (err) {
    console.error("getRoundsForUser error:", err);
    res.status(400).json({ ok:false, error:String(err.message||err) });
  }
});

export default router;
