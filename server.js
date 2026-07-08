require("dotenv").config();

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const compression = require("compression");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const speakeasy = require("speakeasy");
const { Pool } = require("pg");
const { z } = require("zod");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === "production";
const adminSessionHours = Number(process.env.ADMIN_SESSION_HOURS || 8);
const publicDir = __dirname;
const dataDir = path.join(__dirname, "data");
const localQuotesPath = path.join(dataDir, "quote-requests.jsonl");
const databaseUrl = process.env.DATABASE_URL;

fs.mkdirSync(dataDir, { recursive: true });

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    console.warn("WARNING: SESSION_SECRET should be set and at least 32 characters long.");
}

if (!process.env.ADMIN_CODE_HASH || !process.env.TOTP_SECRET) {
    console.warn("WARNING: ADMIN_CODE_HASH and TOTP_SECRET are required for admin login.");
}

let pool = null;

if (databaseUrl) {
    pool = new Pool({
        connectionString: databaseUrl,
        ssl: isProduction ? { rejectUnauthorized: false } : false,
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000
    });
}

const quoteSchema = z.object({
    product_type: z.enum(["Áo thun", "Hoodie", "Áo khoác", "Đồng phục", "Bộ sưu tập đặt riêng"]),
    quantity: z.coerce.number().int().min(100).max(100000),
    deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    contact: z.string().trim().min(5).max(120),
    order_details: z.string().trim().max(1200).optional().default(""),
    "bot-field": z.string().optional().default(""),
    "form-name": z.string().optional()
});

function hashIp(ip) {
    const secret = process.env.SESSION_SECRET || "local-development-secret";
    return crypto.createHmac("sha256", secret).update(ip || "unknown").digest("hex");
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

async function initStorage() {
    if (!pool) return;

    await pool.query(`
        CREATE TABLE IF NOT EXISTS quote_requests (
            id BIGSERIAL PRIMARY KEY,
            product_type TEXT NOT NULL,
            quantity INTEGER NOT NULL,
            deadline DATE NOT NULL,
            contact TEXT NOT NULL,
            order_details TEXT,
            ip_hash TEXT,
            user_agent TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `);
}

async function saveQuote(quote) {
    if (pool) {
        await pool.query(
            `INSERT INTO quote_requests (product_type, quantity, deadline, contact, order_details, ip_hash, user_agent)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [quote.product_type, quote.quantity, quote.deadline, quote.contact, quote.order_details, quote.ip_hash, quote.user_agent]
        );
        return;
    }

    fs.appendFileSync(localQuotesPath, `${JSON.stringify({ ...quote, created_at: new Date().toISOString() })}\n`, "utf8");
}

async function getQuotes() {
    if (pool) {
        const result = await pool.query(`
            SELECT id, product_type, quantity, deadline::text, contact, order_details, created_at::text
            FROM quote_requests
            ORDER BY created_at DESC
            LIMIT 500
        `);
        return result.rows;
    }

    if (!fs.existsSync(localQuotesPath)) return [];

    return fs.readFileSync(localQuotesPath, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line, index) => ({ id: index + 1, ...JSON.parse(line) }))
        .reverse()
        .slice(0, 500);
}

app.set("trust proxy", 1);
app.disable("x-powered-by");

const cspDirectives = {
    defaultSrc: ["'self'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    frameAncestors: ["'none'"],
    objectSrc: ["'none'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "https://fonts.googleapis.com"],
    fontSrc: ["https://fonts.gstatic.com"],
    imgSrc: ["'self'", "https://images.unsplash.com", "data:"],
    connectSrc: ["'self'"]
};

if (isProduction) {
    cspDirectives.upgradeInsecureRequests = [];
}

app.use(helmet({
    contentSecurityPolicy: { directives: cspDirectives },
    crossOriginEmbedderPolicy: false,
    hsts: isProduction ? { maxAge: 15552000, includeSubDomains: true } : false
}));

app.use(compression());
app.use(express.urlencoded({ extended: false, limit: "16kb" }));
app.use(express.json({ limit: "16kb" }));

app.use(rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false
}));

const quoteLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { ok: false, message: "Bạn gửi quá nhiều yêu cầu. Vui lòng thử lại sau." }
});

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: "Đăng nhập sai quá nhiều lần. Vui lòng thử lại sau 15 phút."
});

app.use(session({
    name: "weviet.sid",
    secret: process.env.SESSION_SECRET || "change-this-local-development-secret-only",
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
        httpOnly: true,
        sameSite: "strict",
        secure: isProduction,
        maxAge: adminSessionHours * 60 * 60 * 1000
    }
}));

app.post("/api/quotes", quoteLimiter, async (req, res) => {
    const parsed = quoteSchema.safeParse(req.body);

    if (!parsed.success) {
        return res.status(400).json({ ok: false, message: "Thông tin chưa hợp lệ. Vui lòng kiểm tra lại." });
    }

    if (parsed.data["bot-field"]) {
        return res.json({ ok: true, message: "Đã nhận yêu cầu." });
    }

    await saveQuote({
        product_type: parsed.data.product_type,
        quantity: parsed.data.quantity,
        deadline: parsed.data.deadline,
        contact: parsed.data.contact,
        order_details: parsed.data.order_details,
        ip_hash: hashIp(req.ip),
        user_agent: String(req.get("user-agent") || "").slice(0, 300)
    });

    res.json({ ok: true, message: "Đã nhận yêu cầu báo giá." });
});

function requireAdmin(req, res, next) {
    if (req.session && req.session.admin === true) return next();
    return res.redirect("/admin");
}

function renderAdminLogin(error = "") {
    return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>We Viet Admin</title><link rel="stylesheet" href="/Style.css"><style>.admin-page{min-height:100vh;display:grid;place-items:center;padding:24px;background:#151515;color:#151515}.admin-box{width:min(440px,100%);background:#fff;border-radius:8px;padding:28px;box-shadow:0 26px 80px rgba(0,0,0,.28)}.admin-box h1{font-size:28px;margin-bottom:8px}.admin-box p{color:#66615b;margin-bottom:18px}.admin-box form{display:grid;gap:14px}.admin-box label{display:grid;gap:8px;font-weight:700;color:#66615b}.admin-box input{min-height:46px;padding:0 14px;border:1px solid #ded8cf;border-radius:8px;font:inherit}.admin-error{padding:12px;border-radius:8px;background:#fde7df;color:#8f2d12;font-weight:700;margin-bottom:14px}</style></head><body><main class="admin-page"><section class="admin-box"><h1>We Viet Admin</h1><p>Nhập mã chủ sở hữu và mã 6 số từ Authenticator.</p>${error ? `<div class="admin-error">${escapeHtml(error)}</div>` : ""}<form method="post" action="/api/admin/login"><label>Mã chủ sở hữu<input type="password" name="owner_code" autocomplete="current-password" required></label><label>Mã Authenticator<input type="text" name="totp" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" required></label><button class="primary-button" type="submit">Đăng nhập</button></form></section></main></body></html>`;
}

app.get("/admin", (req, res) => {
    if (req.session.admin) return res.redirect("/admin/dashboard");
    res.send(renderAdminLogin(req.session.loginError));
    req.session.loginError = "";
});

app.post("/api/admin/login", loginLimiter, async (req, res) => {
    const ownerCode = String(req.body.owner_code || "");
    const totp = String(req.body.totp || "").replace(/\s/g, "");
    const hash = process.env.ADMIN_CODE_HASH;
    const secret = process.env.TOTP_SECRET;

    if (!hash || !secret) {
        req.session.loginError = "Admin chưa được cấu hình trên server.";
        return res.redirect("/admin");
    }

    const codeOk = await bcrypt.compare(ownerCode, hash);
    const totpOk = speakeasy.totp.verify({ secret, encoding: "base32", token: totp, window: 1 });

    if (!codeOk || !totpOk) {
        req.session.loginError = "Mã đăng nhập hoặc Authenticator không đúng.";
        return res.redirect("/admin");
    }

    req.session.regenerate((err) => {
        if (err) return res.status(500).send("Không thể tạo phiên đăng nhập.");
        req.session.admin = true;
        req.session.createdAt = Date.now();
        res.redirect("/admin/dashboard");
    });
});

app.post("/api/admin/logout", requireAdmin, (req, res) => {
    req.session.destroy(() => res.redirect("/admin"));
});

app.get("/admin/dashboard", requireAdmin, async (req, res) => {
    const rows = await getQuotes();
    const tableRows = rows.map((row) => `<tr><td>${escapeHtml(row.created_at)}</td><td>${escapeHtml(row.product_type)}</td><td>${escapeHtml(row.quantity)}</td><td>${escapeHtml(row.deadline)}</td><td>${escapeHtml(row.contact)}</td><td>${escapeHtml(row.order_details)}</td></tr>`).join("");
    res.send(`<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Yêu cầu báo giá - We Viet</title><link rel="stylesheet" href="/Style.css"><style>.admin-dashboard{min-height:100vh;background:#f4f1ec;padding:32px 6vw}.admin-top{display:flex;justify-content:space-between;gap:16px;align-items:center;margin-bottom:24px}.admin-top h1{font-size:34px}.logout-btn{border:0}.table-wrap{overflow:auto;background:#fff;border:1px solid #ded8cf;border-radius:8px;box-shadow:0 18px 45px rgba(26,24,22,.12)}table{width:100%;border-collapse:collapse;min-width:960px}th,td{padding:14px;border-bottom:1px solid #ded8cf;text-align:left;vertical-align:top}th{background:#151515;color:#fff}td{color:#151515}.empty{padding:24px;color:#66615b}</style></head><body><main class="admin-dashboard"><div class="admin-top"><div><p class="eyebrow">We Viet Admin</p><h1>Yêu cầu báo giá</h1></div><form method="post" action="/api/admin/logout"><button class="primary-button logout-btn" type="submit">Đăng xuất</button></form></div><div class="table-wrap">${rows.length ? `<table><thead><tr><th>Thời gian</th><th>Sản phẩm</th><th>Số lượng</th><th>Deadline</th><th>Liên hệ</th><th>Chi tiết</th></tr></thead><tbody>${tableRows}</tbody></table>` : `<p class="empty">Chưa có yêu cầu báo giá nào.</p>`}</div></main></body></html>`);
});

app.use(express.static(publicDir, {
    extensions: ["html"],
    index: "index.html",
    maxAge: isProduction ? "1h" : 0,
    setHeaders(res, filePath) {
        if (filePath.endsWith(".html")) res.setHeader("Cache-Control", "no-store");
    }
}));

app.use((req, res) => {
    res.status(404).send("Không tìm thấy trang.");
});

initStorage()
    .then(() => {
        app.listen(PORT, () => console.log(`We Viet backend running on port ${PORT}`));
    })
    .catch((error) => {
        console.error("Could not initialize storage", error);
        process.exit(1);
    });
