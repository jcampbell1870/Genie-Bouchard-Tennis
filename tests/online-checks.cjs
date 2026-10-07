"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const vm = require("node:vm");
const fs = require("node:fs");
const { once } = require("node:events");
const engine = require("../docs/online-game.js");
const { createServer } = require("../server/server.cjs");
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fixture(t, options = {}) {
  const server = createServer({ sessionRequestsPerMinute: 100, ...options });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise(resolve => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(route, { token, method = "GET", data, headers = {}, raw } = {}) {
    const response = await fetch(base + route, {
      method, headers: { ...(token ? { Authorization: ["Bearer", token].join(" ") } : {}),
        ...(data !== undefined || raw !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
      body: raw !== undefined ? raw : data !== undefined ? JSON.stringify(data) : undefined
    });
    const content = await response.text();
    let value;
    try { value = JSON.parse(content); } catch { value = content; }
    return { status: response.status, value, headers: response.headers };
  }
  async function session(name = "Player") {
    const result = await request("/api/session", { method: "POST", data: { name } });
    assert.equal(result.status, 201);
    assert.match(result.value.token, /^[A-Za-z0-9_-]{43}$/);
    return result.value;
  }
  async function room(player, mode = "duel") {
    const result = await request("/api/rooms", { token: player.token, method: "POST", data: { name: "Court", mode } });
    assert.equal(result.status, 201);
    return result.value;
  }
  async function join(roomId, player) {
    return request(`/api/rooms/${roomId}/join`, { token: player.token, method: "POST", data: {} });
  }
  async function poll(roomId, player, predicate, timeout = 2000) {
    const deadline = Date.now() + timeout;
    do {
      const result = await request(`/api/rooms/${roomId}`, { token: player.token });
      assert.equal(result.status, 200);
      if (predicate(result.value)) return result.value;
      await delay(15);
    } while (Date.now() < deadline);
    assert.fail("Room did not reach expected state");
  }
  return { server, base, request, session, room, join, poll };
}

test("shared engine loads unchanged in a browser and has fair deterministic stats", () => {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve("../docs/online-game.js"), "utf8"), context);
  assert.equal(typeof context.window.OnlineTennis.step, "function");
  assert.deepEqual(engine.stats, { speed: 155, reach: 27, shot: 210 });
  assert.deepEqual(engine.court, { left: 45, right: 435, top: 72, bottom: 310, net: 191 });
  const state = engine.createState();
  const duplicate = engine.createState();
  for (let i = 0; i < 200; i++) {
    const input = [{ x: 1, y: -1, swing: i === 0 }, { x: -1, y: 1, swing: false }];
    engine.step(state, input);
    engine.step(duplicate, input);
  }
  assert.deepEqual(state, duplicate);
  assert.ok(state.playerX >= 45 && state.playerX <= 435);
  assert.ok(state.opponentY >= 72 && state.opponentY <= 173);
});

test("ordinary deuce, advantage, sets and 6–6 tiebreak scoring", () => {
  const state = engine.createState();
  state.points = [3, 3];
  engine.awardPoint(state, 0);
  assert.equal(engine.pointLabel(state, 0), "AD");
  engine.awardPoint(state, 1);
  assert.equal(engine.pointLabel(state, 0), "40");
  engine.awardPoint(state, 0);
  engine.awardPoint(state, 0);
  assert.deepEqual(state.games, [1, 0]);
  assert.deepEqual(state.points, [0, 0]);
  assert.equal(engine.server(state), 1);
  state.games = [5, 5];
  for (let i = 0; i < 4; i++) engine.awardPoint(state, 0);
  assert.deepEqual(state.games, [6, 5]);
  assert.equal(state.winner, -1);
  for (let i = 0; i < 4; i++) engine.awardPoint(state, 1);
  assert.equal(engine.tieBreak(state), true);
  const serveOrder = [];
  for (let i = 0; i < 6; i++) {
    serveOrder.push(engine.server(state));
    engine.awardPoint(state, i % 2);
  }
  assert.deepEqual(serveOrder, [0, 1, 1, 0, 0, 1]);
  state.points = [6, 6];
  engine.awardPoint(state, 1);
  assert.equal(state.winner, -1);
  engine.awardPoint(state, 1);
  assert.equal(state.winner, 1);
  assert.deepEqual(state.games, [6, 7]);
  const won = structuredClone(state);
  engine.awardPoint(state, 0);
  engine.step(state, [{ swing: true }, {}]);
  assert.deepEqual(state, won);
  const straightSet = engine.createState();
  for (let i = 0; i < 24; i++) engine.awardPoint(straightSet, 0);
  assert.equal(straightSet.winner, 0);
  assert.deepEqual(straightSet.games, [6, 0]);
});

test("both seats serve and hit with identical movement and shot speed", () => {
  for (const seat of [0, 1]) {
    const state = engine.createState();
    state.games = seat === 1 ? [1, 0] : [0, 0];
    // Reset the serving position through a point, retaining the game's server.
    engine.awardPoint(state, 0);
    const inputs = [{ x: 0, y: 0, swing: false }, { x: 0, y: 0, swing: false }];
    inputs[seat].swing = true;
    engine.step(state, inputs);
    assert.equal(state.waiting, false);
    assert.equal(state.lastHitter, seat);
    assert.ok(Math.abs(Math.hypot(state.vx, state.vy) - 210) < 0.001);
    const receiver = 1 - seat;
    state.bounced = true;
    state.servingFlight = false;
    state.ballX = receiver === 0 ? state.playerX : state.opponentX;
    state.ballY = receiver === 0 ? state.playerY : state.opponentY;
    inputs[seat].swing = false;
    inputs[receiver].swing = true;
    engine.step(state, inputs);
    assert.equal(state.lastHitter, receiver);
    assert.ok(Math.abs(Math.hypot(state.vx, state.vy) - 210) < 0.001);
  }
});

test("HTTP duel auto-starts, authoritative input is bounded, stale input stops and leave forfeits", async t => {
  const f = await fixture(t, { inputStaleMs: 80 });
  const a = await f.session("A");
  const b = await f.session("B");
  const outsider = await f.session("Outsider");
  const room = await f.room(a);
  assert.equal(room.capacity, 2);
  assert.equal(room.status, "waiting");
  assert.equal((await f.join(room.id, b)).status, 200);
  assert.equal((await f.join(room.id, outsider)).status, 409);
  assert.equal((await f.request(`/api/rooms/${room.id}`, { token: outsider.token })).status, 403);
  const current = await f.poll(room.id, a, r => r.status === "playing");
  assert.equal(current.match.seat, 0);
  assert.equal(current.match.players.length, 2);
  assert.equal(current.bracket.length, 1);
  for (const key of ["points", "games", "winner", "playerX", "playerY", "opponentX", "opponentY",
    "ballX", "ballY", "vx", "vy", "bounceY", "waiting", "servingFlight", "bounced", "lastHitter", "message"])
    assert.ok(Object.hasOwn(current.match.state, key), key);
  assert.equal((await f.request(`/api/rooms/${room.id}/input`, { token: a.token, method: "POST",
    data: { x: 0, y: 0, swing: true, winner: 0 } })).status, 400);
  assert.equal((await f.request(`/api/rooms/${room.id}/input`, { token: a.token, method: "POST",
    data: { x: 0, y: 0, swing: true } })).status, 200);
  await delay(25);
  await f.request(`/api/rooms/${room.id}/input`, { token: a.token, method: "POST",
    data: { x: 1, y: 0, swing: false } });
  await delay(130);
  const stopped = await f.request(`/api/rooms/${room.id}`, { token: a.token });
  assert.ok(stopped.value.match.state.playerX > 315);
  const x = stopped.value.match.state.playerX;
  await delay(60);
  assert.equal((await f.request(`/api/rooms/${room.id}`, { token: a.token })).value.match.state.playerX, x);
  assert.equal((await f.request(`/api/rooms/${room.id}/leave`, { token: b.token, method: "POST", data: {} })).status, 200);
  const finished = await f.poll(room.id, a, r => r.status === "finished");
  assert.equal(finished.champion.id, a.playerId);
  assert.equal(finished.match.state.winner, 0);
  assert.equal((await f.request(`/api/rooms/${room.id}`, { token: b.token })).status, 403);
});

test("exactly eight seeded entrants automatically advance all seven matches including disconnect", async t => {
  const f = await fixture(t, { tickMs: 5, engine: { ...engine,
    step(state, inputs) {
      // Test-only acceleration: server-side scoring, never a client winner field.
      if (inputs[0].swing || inputs[1].swing) engine.awardPoint(state, 0);
      return state;
    }
  } });
  const players = [];
  for (let i = 1; i <= 9; i++) players.push(await f.session(`Seed ${i}`));
  const room = await f.room(players[0], "tournament");
  for (let i = 1; i < 7; i++) {
    const joined = await f.join(room.id, players[i]);
    assert.equal(joined.value.status, "waiting");
    assert.equal(joined.value.match, null);
  }
  const started = await f.join(room.id, players[7]);
  assert.equal(started.value.status, "playing");
  assert.equal(started.value.bracket.length, 7);
  assert.equal(started.value.bracket.filter(b => b.status === "playing").length, 4);
  assert.deepEqual(started.value.bracket[0].players.map(p => p.id), [players[0].playerId, players[7].playerId]);
  assert.equal((await f.join(room.id, players[8])).status, 409);
  await f.request(`/api/rooms/${room.id}/leave`, { token: players[7].token, method: "POST", data: {} });
  const afterDisconnect = await f.request(`/api/rooms/${room.id}`, { token: players[0].token });
  assert.equal(afterDisconnect.value.bracket[0].winnerId, players[0].playerId);
  let final;
  const deadline = Date.now() + 3500;
  do {
    for (const player of players.slice(0, 7)) {
      const view = await f.request(`/api/rooms/${room.id}`, { token: player.token });
      if (view.value.status === "finished") { final = view.value; break; }
      if (view.value.match && view.value.match.state.winner < 0)
        await f.request(`/api/rooms/${room.id}/input`, { token: player.token, method: "POST",
          data: { x: 0, y: 0, swing: true } });
    }
    if (final) break;
    await delay(30);
  } while (Date.now() < deadline);
  assert.ok(final, "Tournament completed");
  assert.equal(final.champion.id, players[0].playerId);
  assert.equal(final.bracket.filter(b => b.status === "finished").length, 7);
  assert.equal(final.bracket[6].winnerId, final.champion.id);
  const lobby = await f.request("/api/lobby", { token: players[8].token });
  assert.equal(lobby.value.playerId, players[8].playerId);
  assert.equal(lobby.value.rooms[0].capacity, 8);
  assert.ok(!JSON.stringify(lobby.value).includes("token"));
});

test("room heartbeats, idle forfeits and waiting membership cleanup", async t => {
  const f = await fixture(t, { heartbeatTimeoutMs: 150, idleTimeoutMs: 5000, tickMs: 5 });
  const a = await f.session("Active");
  const b = await f.session("Disconnected");
  const room = await f.room(a);
  await f.join(room.id, b);
  const result = await f.poll(room.id, a, r => r.status === "finished");
  assert.equal(result.champion.id, a.playerId);
  assert.equal(result.players.length, 1);
  assert.match(result.match.state.message, /DISCONNECTED/);
  const c = await f.session("Waiting");
  const waiting = await f.room(c);
  await delay(190);
  assert.equal((await f.request(`/api/rooms/${waiting.id}`, { token: c.token })).status, 404);
  const idle = await fixture(t, { idleTimeoutMs: 100, heartbeatTimeoutMs: 5000, tickMs: 5 });
  const p = await idle.session("P");
  const q = await idle.session("Q");
  const idleRoom = await idle.room(p);
  await idle.join(idleRoom.id, q);
  const idleResult = await idle.poll(idleRoom.id, p, r => r.status === "finished");
  assert.match(idleResult.match.state.message, /IDLE FORFEIT/);
});

test("a winner leaving before the next round cannot rejoin and forfeits the future match", async t => {
  const f = await fixture(t, { engine: { ...engine,
    step(state, inputs) {
      if (inputs.some(input => input.swing)) engine.awardPoint(state, 0);
      return state;
    }
  } });
  const players = [];
  for (let i = 0; i < 8; i++) players.push(await f.session(`Player ${i + 1}`));
  const room = await f.room(players[0], "tournament");
  for (const player of players.slice(1)) await f.join(room.id, player);
  // Seed 1 advances, then disconnects while waiting for seed 4's quarterfinal.
  await f.request(`/api/rooms/${room.id}/leave`, { token: players[7].token, method: "POST" });
  await f.request(`/api/rooms/${room.id}/leave`, { token: players[0].token, method: "POST" });
  assert.equal((await f.join(room.id, players[0])).status, 409);
  for (const player of [players[3], players[1], players[2]])
    await f.request(`/api/rooms/${room.id}/input`, { token: player.token, method: "POST",
      data: { x: 0, y: 0, swing: true } });
  const advanced = await f.poll(room.id, players[3], r => r.bracket[4].status === "finished");
  assert.equal(advanced.bracket[4].winnerId, players[3].playerId);
  assert.equal(advanced.bracket[4].players[0].id, players[0].playerId);
});

test("authorization, bad data, CORS, body limits, static serving and global resource limits", async t => {
  const f = await fixture(t, { maxSessions: 3, maxRooms: 1, maxBodyBytes: 128 });
  assert.equal((await f.request("/health")).value.ok, true);
  const staticPage = await f.request("/");
  assert.equal(staticPage.status, 200);
  assert.match(staticPage.value, /<!doctype html>/i);
  assert.equal((await f.request("/server/server.cjs")).status, 404);
  assert.equal((await f.request("/%2eenv")).status, 403);
  assert.equal((await f.request("/api/lobby")).status, 401);
  assert.equal((await f.request("/api/lobby", { token: "not-valid" })).status, 401);
  assert.equal((await f.request("/api/session", { method: "POST", data: { name: "bad" },
    headers: { Origin: "https://evil.example" } })).status, 403);
  const cors = await f.request("/api/session", { method: "OPTIONS",
    headers: { Origin: "http://localhost:8000", "Access-Control-Request-Method": "POST" } });
  assert.equal(cors.status, 204);
  assert.equal(cors.headers.get("access-control-allow-origin"), "http://localhost:8000");
  assert.equal((await f.request("/api/session", { method: "POST", raw: "{" })).status, 400);
  assert.equal((await f.request("/api/session", { method: "POST", data: { name: "" } })).status, 400);
  assert.equal((await f.request("/api/session", { method: "POST", data: [] })).status, 400);
  assert.equal((await f.request("/api/session", { method: "POST", raw: '{"name":"' + "x".repeat(200) + '"}' })).status, 413);
  const a = await f.session("A");
  const b = await f.session("B");
  const c = await f.session("C");
  assert.equal((await f.request("/api/session", { method: "POST", data: { name: "D" } })).status, 503);
  assert.equal((await f.request("/api/rooms", { token: a.token, method: "POST", data: { name: "Bad", mode: "money" } })).status, 400);
  const room = await f.room(a);
  assert.equal((await f.request("/api/rooms", { token: b.token, method: "POST", data: { name: "Full", mode: "duel" } })).status, 503);
  await f.join(room.id, b);
  assert.equal((await f.request(`/api/rooms/${room.id}/input`, { token: a.token, method: "POST",
    data: { x: 2, y: 0, swing: false } })).status, 400);
  assert.equal((await f.request(`/api/rooms/${room.id}/input`, { token: c.token, method: "POST",
    data: { x: 0, y: 0, swing: false } })).status, 403);
});

test("chunked oversized bodies are rejected without retaining unlimited data", async t => {
  const f = await fixture(t, { maxBodyBytes: 80 });
  const status = await new Promise((resolve, reject) => {
    const req = http.request(f.base + "/api/session", {
      method: "POST", headers: { "Content-Type": "application/json", "Transfer-Encoding": "chunked" }
    }, res => { res.resume(); resolve(res.statusCode); });
    req.on("error", reject);
    req.write('{"name":"');
    req.end("x".repeat(100) + '"}');
  });
  assert.equal(status, 413);
  assert.equal((await f.request("/health")).status, 200);
});

test("input and session rate limits allow normal clients but reject flooding", async t => {
  const f = await fixture(t, { sessionRequestsPerMinute: 3, inputRequestsPerSecond: 25 });
  const a = await f.session("A");
  const b = await f.session("B");
  await f.session("C");
  assert.equal((await f.request("/api/session", { method: "POST", data: { name: "Flood" } })).status, 429);
  const room = await f.room(a);
  await f.join(room.id, b);
  for (let i = 0; i < 20; i++)
    assert.equal((await f.request(`/api/rooms/${room.id}/input`, { token: a.token, method: "POST",
      data: { x: 0, y: 0, swing: false } })).status, 200);
  let rateLimited = false;
  for (let i = 0; i < 10; i++) {
    const result = await f.request(`/api/rooms/${room.id}/input`, { token: a.token, method: "POST",
      data: { x: 0, y: 0, swing: false } });
    rateLimited ||= result.status === 429;
  }
  assert.equal(rateLimited, true);
});
