// src/db.js
import pkg from "pg";
const { Pool } = pkg;
import { Connector } from "@google-cloud/cloud-sql-connector";

let pool = null;

export async function getPool() {
  if (pool) return pool;

  const {
    NODE_ENV = "development",
    PGHOST = "127.0.0.1",
    PGPORT = "5432",
    PGUSER = "postgres",
    PGPASSWORD = "",
    PGDATABASE = "kpi_db",
    INSTANCE_CONNECTION_NAME = "", // ví dụ: project:region:instance
    DB_USER,
    DB_PASS,
    DB_NAME,
  } = process.env;

  if (NODE_ENV === "production" && INSTANCE_CONNECTION_NAME) {
    // Production: dùng Cloud SQL Connector
    const connector = new Connector();
    const clientOpts = await connector.getOptions({
      instanceConnectionName: INSTANCE_CONNECTION_NAME,
      ipType: "PUBLIC", // hoặc "PRIVATE" nếu bạn bật Private IP
    });

    pool = new Pool({
      ...clientOpts,
      user: DB_USER,
      password: DB_PASS,
      database: DB_NAME,
      max: 10,
      idleTimeoutMillis: 60000,
    });
  } else {
    // Local/dev: dùng PGHOST/PGPORT
    pool = new Pool({
      host: PGHOST,
      port: Number(PGPORT),
      user: PGUSER,
      password: PGPASSWORD,
      database: PGDATABASE,
    });
  }

  pool.on("error", (err) => console.error("pg pool error:", err));
  return pool;
}
