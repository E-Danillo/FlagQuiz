"use strict";

const fs = require("fs");
const path = require("path");
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Database = require("better-sqlite3");

const JWT_SECRET =
  process.env.JWT_SECRET || "flagquiz-dev-secret-altere-antes-de-publicar";
const PORT = Number(process.env.PORT) || 3000;

const dataDir = path.join(__dirname, "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, "flagquiz.db");
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score INTEGER NOT NULL,
  xp INTEGER NOT NULL,
  correct INTEGER NOT NULL,
  wrong INTEGER NOT NULL,
  mode TEXT NOT NULL,
  played_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_matches_user_played ON matches(user_id, played_at DESC);
CREATE INDEX IF NOT EXISTS idx_matches_played ON matches(played_at);
`);

/** Segunda-feira 00:00 (hora local do servidor) como ISO UTC aproximado para filtro */
function startOfWeekISO() {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diff);
  monday.setHours(0, 0, 0, 0);
  return monday.toISOString();
}

function authMiddleware(req, res, next) {
  const h = req.headers.authorization;
  if (!h || !h.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Token necessário." });
  }
  try {
    const payload = jwt.verify(h.slice(7), JWT_SECRET);
    const uid = Number(payload.sub);
    if (!Number.isFinite(uid)) throw new Error("bad sub");
    req.userId = uid;
    next();
  } catch {
    return res.status(401).json({ error: "Sessão inválida." });
  }
}

const app = express();
app.use(express.json({ limit: "48kb" }));

app.post("/api/auth/register", (req, res) => {
  try {
    const { email, password, displayName } = req.body || {};
    if (!email || !password || displayName == null || displayName === "") {
      return res.status(400).json({ error: "Preencha e-mail, senha e nome." });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: "Senha: mínimo 6 caracteres." });
    }
    const name = String(displayName).trim();
    if (name.length < 2 || name.length > 40) {
      return res.status(400).json({ error: "Nome: entre 2 e 40 caracteres." });
    }
    const hash = bcrypt.hashSync(password, 10);
    const created = new Date().toISOString();
    const emailNorm = String(email).trim().toLowerCase();
    const info = db
      .prepare(
        "INSERT INTO users (email, password_hash, display_name, created_at) VALUES (?,?,?,?)"
      )
      .run(emailNorm, hash, name, created);
    const token = jwt.sign({ sub: info.lastInsertRowid }, JWT_SECRET, {
      expiresIn: "30d",
    });
    res.json({
      token,
      user: {
        id: info.lastInsertRowid,
        displayName: name,
        email: emailNorm,
      },
    });
  } catch (e) {
    if (String(e.message || e).includes("UNIQUE")) {
      return res.status(409).json({ error: "Este e-mail já está registado." });
    }
    console.error(e);
    res.status(500).json({ error: "Erro ao registar." });
  }
});

app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "E-mail e senha obrigatórios." });
  }
  const emailNorm = String(email).trim().toLowerCase();
  const row = db
    .prepare(
      "SELECT id, password_hash, display_name, email FROM users WHERE email = ?"
    )
    .get(emailNorm);
  if (!row || !bcrypt.compareSync(password, row.password_hash)) {
    return res.status(401).json({ error: "E-mail ou senha incorretos." });
  }
  const token = jwt.sign({ sub: row.id }, JWT_SECRET, { expiresIn: "30d" });
  res.json({
    token,
    user: { id: row.id, displayName: row.display_name, email: row.email },
  });
});

app.get("/api/auth/me", authMiddleware, (req, res) => {
  const row = db
    .prepare("SELECT id, display_name, email FROM users WHERE id = ?")
    .get(req.userId);
  if (!row) return res.status(404).json({ error: "Utilizador não encontrado." });
  res.json({
    user: { id: row.id, displayName: row.display_name, email: row.email },
  });
});

app.post("/api/matches", authMiddleware, (req, res) => {
  const { score, xp, correct, wrong, mode } = req.body || {};
  if (
    typeof score !== "number" ||
    typeof xp !== "number" ||
    typeof correct !== "number" ||
    typeof wrong !== "number" ||
    mode == null
  ) {
    return res.status(400).json({ error: "Dados da partida inválidos." });
  }
  if (!["flag-to-name", "name-to-flag"].includes(mode)) {
    return res.status(400).json({ error: "Modo inválido." });
  }
  const playedAt = new Date().toISOString();
  db.prepare(
    "INSERT INTO matches (user_id, score, xp, correct, wrong, mode, played_at) VALUES (?,?,?,?,?,?,?)"
  ).run(
    req.userId,
    Math.floor(score),
    Math.floor(xp),
    Math.floor(correct),
    Math.floor(wrong),
    mode,
    playedAt
  );

  const count = db
    .prepare("SELECT COUNT(*) AS c FROM matches WHERE user_id = ?")
    .get(req.userId).c;
  if (count > 10) {
    const excess = count - 10;
    const oldRows = db
      .prepare(
        "SELECT id FROM matches WHERE user_id = ? ORDER BY played_at ASC LIMIT ?"
      )
      .all(req.userId, excess);
    const ids = oldRows.map((r) => r.id);
    if (ids.length) {
      const ph = ids.map(() => "?").join(",");
      db.prepare(
        `DELETE FROM matches WHERE user_id = ? AND id IN (${ph})`
      ).run(req.userId, ...ids);
    }
  }

  res.status(201).json({ ok: true });
});

app.get("/api/matches/me", authMiddleware, (req, res) => {
  const rows = db
    .prepare(
      `SELECT score, xp, correct, wrong, mode, played_at
       FROM matches WHERE user_id = ? ORDER BY played_at DESC LIMIT 10`
    )
    .all(req.userId);
  res.json({ matches: rows });
});

app.get("/api/leaderboard/week", (req, res) => {
  const since = startOfWeekISO();
  const raw = Number(req.query.limit);
  const limit = Number.isFinite(raw)
    ? Math.min(50, Math.max(5, Math.floor(raw)))
    : 20;
  const rows = db
    .prepare(
      `SELECT m.score, m.xp, m.played_at, u.display_name
       FROM matches m
       JOIN users u ON u.id = m.user_id
       WHERE datetime(m.played_at) >= datetime(?)
       ORDER BY m.score DESC, datetime(m.played_at) ASC
       LIMIT ?`
    )
    .all(since, limit);
  res.json({ since, entries: rows });
});

app.use(express.static(path.join(__dirname, "public")));

app.listen(PORT, () => {
  console.log(`FlagQuiz em http://localhost:${PORT}`);
  console.log("Defina JWT_SECRET no ambiente em produção.");
});
