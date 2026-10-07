"use strict";

const http = require("node:http");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const tennis = require("../docs/online-game.js");

const publicPlayer = player => ({ id: player.id, name: player.name });
const neutral = Object.freeze({ x: 0, y: 0, swing: false });
const fail = (status, message) => Object.assign(new Error(message), { status });

function createServer(options = {}) {
  const config = {
    allowedOrigins: (process.env.ALLOWED_ORIGINS || "http://localhost:8080,http://localhost:8000").split(",").map(s => s.trim()).filter(Boolean),
    heartbeatTimeoutMs: 30000, idleTimeoutMs: 120000, inputStaleMs: 750,
    sessionTimeoutMs: 3600000, roomRetentionMs: 1800000, waitingTimeoutMs: 600000,
    maxSessions: 1000, maxRooms: 100, maxBodyBytes: 2048,
    maxConnections: 512,
    sessionRequestsPerMinute: 20, inputRequestsPerSecond: 40, requestsPerSecond: 120,
    tickMs: 1000 / 60,
    ...options
  };
  const engine = options.engine || tennis;
  const sessions = new Map();
  const rooms = new Map();
  const addresses = new Map();
  let previousTick = Date.now();
  let stepBudget = 0;
  const docsRoot = path.resolve(__dirname, "../docs");
  const id = () => crypto.randomUUID();
  const limit = (map, key, max, duration, now) => {
    let entry = map.get(key);
    if (!entry || now >= entry.until) {
      entry = { count: 0, until: now + duration };
      map.set(key, entry);
    }
    if (++entry.count > max) throw fail(429, "Request rate limit exceeded");
  };
  function text(value, fallback) {
    if (value === undefined && fallback) return fallback;
    if (typeof value !== "string" || !value.trim() || value.trim().length > 40 ||
        /[\u0000-\u001f\u007f]/.test(value)) throw fail(400, "Name must contain 1–40 printable characters");
    return value.trim();
  }
  function findRoom(roomId) {
    const room = rooms.get(roomId);
    if (!room) throw fail(404, "Room not found");
    return room;
  }
  function member(room, player) {
    if (player.roomId !== room.id || !room.members.has(player.id)) throw fail(403, "Room membership required");
  }
  function roomSummary(room) {
    return { id: room.id, name: room.name, mode: room.mode, status: room.status,
      players: [...room.members.values()].map(publicPlayer), capacity: room.capacity };
  }
  function roomView(room, player) {
    const match = room.matches.find(m => m.players.some(p => p.id === player.id)) || room.lastMatches.get(player.id);
    return {
      ...roomSummary(room),
      bracket: room.bracket.map(b => ({ round: b.round, index: b.index,
        players: b.players.map(p => p ? publicPlayer(p) : null), winnerId: b.winnerId, status: b.status })),
      match: match ? { id: match.id, seat: match.players.findIndex(p => p.id === player.id),
        players: match.players.map(publicPlayer), state: match.state } : null,
      champion: room.champion ? publicPlayer(room.champion) : null
    };
  }
  function createMatch(room, bracket, now) {
    bracket.status = "playing";
    const match = { id: id(), bracket, players: bracket.players, state: engine.createState(),
      inputs: [neutral, neutral], inputTimes: [0, 0], actionTimes: [now, now] };
    room.matches.push(match);
    return match;
  }
  function advance(room, now) {
    let progress = true;
    while (progress && room.status === "playing") {
      progress = false;
      for (const match of [...room.matches]) {
        if (match.state.winner < 0) {
          const absent = match.players.findIndex(p => !room.members.has(p.id));
          if (absent >= 0) engine.forfeit(match.state, absent, "DISCONNECTED");
        }
        if (match.state.winner < 0) continue;
        const winner = match.players[match.state.winner];
        match.bracket.winnerId = winner.id;
        match.bracket.status = "complete";
        room.matches.splice(room.matches.indexOf(match), 1);
        room.lastMatches.set(match.players[0].id, match);
        room.lastMatches.set(match.players[1].id, match);
        progress = true;
        if (room.mode === "duel" || match.bracket.round === 2) {
          room.status = "complete";
          room.champion = winner;
          room.finishedAt = now;
        } else {
          const next = room.bracket.find(b => b.round === match.bracket.round + 1 &&
            b.index === Math.floor(match.bracket.index / 2));
          next.players[match.bracket.index % 2] = winner;
          if (next.players.every(Boolean) && next.status === "waiting") createMatch(room, next, now);
        }
      }
    }
  }
  function fillBracket(room) {
    const entrants = [...room.members.values()];
    // Join order assigns seeds 1–8; standard pairing avoids meeting the top two before the final.
    const order = room.mode === "tournament" ? [0, 7, 3, 4, 1, 6, 2, 5] : [0, 1];
    const rounds = room.mode === "tournament" ? [4, 2, 1] : [1];
    if (!room.bracket.length) {
      rounds.forEach((count, round) => {
        for (let index = 0; index < count; index++)
          room.bracket.push({ round, index, players: [null, null], winnerId: null, status: "waiting" });
      });
    }
    for (const bracket of room.bracket) {
      if (bracket.round === 0)
        bracket.players = [entrants[order[bracket.index * 2]] || null, entrants[order[bracket.index * 2 + 1]] || null];
    }
  }
  function start(room, now) {
    room.status = "playing";
    for (const bracket of room.bracket) if (bracket.round === 0) createMatch(room, bracket, now);
    for (const player of room.members.values()) player.heartbeat = now;
  }
  function leave(room, player, now) {
    room.members.delete(player.id);
    player.roomId = null;
    if (room.status === "playing") advance(room, now);
    if (room.status === "waiting") {
      fillBracket(room);
      room.updatedAt = now;
    }
    if (room.members.size === 0) rooms.delete(room.id);
  }
  function join(room, player, now) {
    if (player.roomId === room.id) return;
    if (player.roomId) throw fail(409, "Leave your current room first");
    if (room.status !== "waiting" || room.members.size >= room.capacity) throw fail(409, "Room is not accepting players");
    player.roomId = room.id;
    player.heartbeat = now;
    room.members.set(player.id, player);
    room.updatedAt = now;
    fillBracket(room);
    if (room.members.size === room.capacity) start(room, now);
  }
  function tick() {
    const now = Date.now();
    stepBudget += Math.min(0.25, (now - previousTick) / 1000);
    previousTick = now;
    const steps = Math.floor(stepBudget * 60);
    stepBudget -= steps / 60;
    for (const [address, entry] of addresses) if (now >= entry.until) addresses.delete(address);
    for (const [token, player] of sessions) {
      if (player.roomId && now - player.heartbeat > config.heartbeatTimeoutMs) {
        const room = rooms.get(player.roomId);
        if (room) leave(room, player, now);
      }
      if (now - player.lastSeen > config.sessionTimeoutMs) {
        if (player.roomId && rooms.has(player.roomId)) leave(rooms.get(player.roomId), player, now);
        sessions.delete(token);
      }
    }
    for (const room of rooms.values()) {
      if ((room.status === "complete" && now - room.finishedAt > config.roomRetentionMs) ||
          (room.status === "waiting" && now - room.updatedAt > config.waitingTimeoutMs)) {
        for (const player of room.members.values()) player.roomId = null;
        rooms.delete(room.id);
        continue;
      }
      if (room.status !== "playing") continue;
      for (const match of room.matches) {
        const idle = match.actionTimes.findIndex(time => now - time > config.idleTimeoutMs);
        if (idle >= 0) engine.forfeit(match.state, idle, "IDLE FORFEIT");
        else {
          const inputs = match.inputs.map((input, seat) =>
            now - match.inputTimes[seat] > config.inputStaleMs ? neutral : input);
          for (let step = 0; step < steps && match.state.winner < 0; step++)
            engine.step(match.state, inputs, 1 / 60);
        }
      }
      advance(room, now);
    }
  }

  async function body(req, optional = false) {
    if (optional && !req.headers["transfer-encoding"] && !(Number(req.headers["content-length"]) > 0)) return {};
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] || "")) throw fail(415, "Use application/json");
    const length = Number(req.headers["content-length"]);
    if (Number.isFinite(length) && length > config.maxBodyBytes) {
      req.resume();
      throw fail(413, "Payload too large");
    }
    const chunks = await new Promise((resolve, reject) => {
      let size = 0;
      let exceeded = false;
      const collected = [];
      req.on("data", chunk => {
        size += chunk.length;
        if (size > config.maxBodyBytes) {
          if (!exceeded) reject(fail(413, "Payload too large"));
          exceeded = true;
          collected.length = 0;
        } else if (!exceeded) collected.push(chunk);
      });
      req.on("end", () => { if (!exceeded) resolve(collected); });
      req.on("error", reject);
      req.on("aborted", () => reject(fail(400, "Request aborted")));
    });
    let value;
    try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { throw fail(400, "Invalid JSON"); }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw fail(400, "JSON object required");
    return value;
  }
  const server = http.createServer(async (req, res) => {
    const send = (status, value) => {
      if (res.destroyed || res.writableEnded) return;
      res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(JSON.stringify(value));
    };
    res.setHeader("X-Content-Type-Options", "nosniff");
    const origin = req.headers.origin;
    if (origin && !config.allowedOrigins.includes(origin)) {
      req.resume();
      send(403, { error: "Origin not allowed" });
      return;
    }
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    try {
      const pathname = new URL(req.url, "http://localhost").pathname;
      if (req.method === "OPTIONS" && pathname.startsWith("/api/")) {
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
        res.setHeader("Access-Control-Max-Age", "600");
        res.writeHead(204);
        res.end();
        return;
      }
      if (req.method === "GET" && pathname === "/health") return send(200, { ok: true });
      if (!pathname.startsWith("/api/")) {
        if (req.method !== "GET" && req.method !== "HEAD") throw fail(405, "Method not allowed");
        let decoded;
        try { decoded = decodeURIComponent(pathname); } catch { throw fail(400, "Invalid path"); }
        const filename = path.resolve(docsRoot, "." + (decoded === "/" ? "/index.html" : decoded));
        if (!filename.startsWith(docsRoot + path.sep) || decoded.includes("\0") ||
            decoded.split("/").some(part => part.startsWith("."))) throw fail(403, "Invalid path");
        let real;
        try { real = await fs.promises.realpath(filename); } catch { throw fail(404, "Not found"); }
        if (!real.startsWith(docsRoot + path.sep)) throw fail(403, "Invalid path");
        const stat = await fs.promises.stat(real);
        if (!stat.isFile()) throw fail(404, "Not found");
        const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
          ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml",
          ".png": "image/png", ".ico": "image/x-icon" };
        res.writeHead(200, { "Content-Type": types[path.extname(real)] || "application/octet-stream",
          "Content-Length": stat.size, "Cache-Control": "no-cache" });
        if (req.method === "HEAD") return res.end();
        const stream = fs.createReadStream(real);
        stream.on("error", () => res.destroy());
        stream.pipe(res);
        return;
      }
      const now = Date.now();
      if (req.method === "POST" && pathname === "/api/session") {
        const address = req.socket.remoteAddress;
        if (!addresses.has(address) && addresses.size >= config.maxSessions) throw fail(503, "Server capacity reached");
        limit(addresses, address, config.sessionRequestsPerMinute, 60000, now);
        if (sessions.size >= config.maxSessions) throw fail(503, "Session capacity reached");
        const data = await body(req);
        if (sessions.size >= config.maxSessions) throw fail(503, "Session capacity reached");
        const player = { id: id(), name: text(data.name), roomId: null, heartbeat: now,
          lastSeen: now, rates: new Map() };
        const token = crypto.randomBytes(32).toString("base64url");
        sessions.set(token, player);
        return send(201, { token, playerId: player.id });
      }
      const authorization = (req.headers.authorization || "").split(" ");
      const player = authorization.length === 2 && authorization[0].toLowerCase() === "bearer"
        ? sessions.get(authorization[1]) : null;
      if (!player) throw fail(401, "Valid bearer token required");
      player.lastSeen = now;
      limit(player.rates, "all", config.requestsPerSecond, 1000, now);
      if (req.method === "GET" && pathname === "/api/lobby")
        return send(200, { rooms: [...rooms.values()].map(roomSummary), playerId: player.id });
      if (req.method === "POST" && pathname === "/api/rooms") {
        if (player.roomId) throw fail(409, "Leave your current room first");
        if (rooms.size >= config.maxRooms) throw fail(503, "Room capacity reached");
        const data = await body(req);
        if (player.roomId) throw fail(409, "Leave your current room first");
        if (rooms.size >= config.maxRooms) throw fail(503, "Room capacity reached");
        if (data.mode !== "duel" && data.mode !== "tournament") throw fail(400, "Mode must be duel or tournament");
        const room = { id: id(), name: text(data.name, "Tennis room"), mode: data.mode,
          status: "waiting", capacity: data.mode === "duel" ? 2 : 8, members: new Map(),
          bracket: [], matches: [], lastMatches: new Map(), champion: null, updatedAt: now };
        rooms.set(room.id, room);
        join(room, player, now);
        return send(201, roomView(room, player));
      }
      const route = /^\/api\/rooms\/([^/]+)(?:\/(join|leave|input))?$/.exec(pathname);
      if (!route) throw fail(404, "Endpoint not found");
      const room = findRoom(route[1]);
      const action = route[2];
      if (req.method === "POST" && action === "join") {
        await body(req, true);
        join(room, player, now);
        return send(200, roomView(room, player));
      }
      member(room, player);
      if (req.method === "GET" && !action) {
        player.heartbeat = now;
        return send(200, roomView(room, player));
      }
      if (req.method === "POST" && action === "leave") {
        await body(req, true);
        leave(room, player, now);
        return send(200, roomView(room, player));
      }
      if (req.method === "POST" && action === "input") {
        limit(player.rates, "input", config.inputRequestsPerSecond, 1000, now);
        const data = await body(req);
        if (!Number.isFinite(data.x) || data.x < -1 || data.x > 1 ||
            !Number.isFinite(data.y) || data.y < -1 || data.y > 1 || typeof data.swing !== "boolean" ||
            Object.keys(data).some(key => !["x", "y", "swing"].includes(key)))
          throw fail(400, "Input requires only x/y in [-1,1] and boolean swing");
        const match = room.matches.find(m => m.players.some(p => p.id === player.id));
        if (!match || match.state.winner >= 0) throw fail(409, "No active match");
        const seat = match.players.findIndex(p => p.id === player.id);
        match.inputs[seat] = { x: data.x, y: data.y, swing: data.swing };
        match.inputTimes[seat] = now;
        if (data.x !== 0 || data.y !== 0 || data.swing) match.actionTimes[seat] = now;
        return send(200, roomView(room, player));
      }
      throw fail(405, "Method not allowed");
    } catch (error) {
      req.resume();
      send(error.status || 500, { error: error.status ? error.message : "Internal server error" });
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  server.maxHeadersCount = 40;
  server.maxConnections = config.maxConnections;
  const timer = setInterval(tick, config.tickMs);
  timer.unref();
  server.on("close", () => clearInterval(timer));
  return server;
}

if (require.main === module) {
  const port = Number(process.env.PORT || 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be in 1–65535");
  const server = createServer();
  server.listen(port, process.env.HOST || "0.0.0.0", () => {
    console.log(`Online tennis listening on http://localhost:${port}`);
  });
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {
    server.close();
    server.closeIdleConnections();
  });
}

module.exports = { createServer };
