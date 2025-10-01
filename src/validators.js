// src/validators.js
import { z } from "zod";

// FE có thể gọi whoAmI không gửi pin → pin optional
export const WhoAmISchema = z.object({
  manv: z.string().min(1, "Required"),
  pin:  z.string().optional()
});

// FE gửi yyyy-mm-dd; các field khác optional
export const RoundsSchema = z.object({
  manv: z.string().min(1, "Required"),
  date: z.string().min(8, "yyyy-mm-dd required").optional(),
  vong: z.string().optional(),
  plate: z.string().optional(),
});

// ✅ Schema cho tiêu chí
export const CriteriaTripSchema = z.object({
  role : z.string().min(1, "Required"),
  date : z.string().optional(),
  vong : z.string().optional(),
  plate: z.string().optional()
});
