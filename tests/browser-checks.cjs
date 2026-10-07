const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { runInNewContext } = require("node:vm");
const { test } = require("node:test");

const source = name => readFileSync(join(__dirname, "../docs", name), "utf8");
function element() {
  return {
    listeners: {}, children: [], disabled: false, hidden: false, value: "", selectedIndex: 0,
    textContent: "", dataset: {}, className: "", classList: { add() {}, remove() {} },
    addEventListener(name, callback) { this.listeners[name] = callback; },
    append(child) { this.children.push(child); },
    replaceChildren() { this.children = []; },
    setAttribute() {}, setPointerCapture() {}, focus() {}
  };
}
function browser() {
  const elements = new Map();
  const $ = selector => {
    if (!elements.has(selector)) elements.set(selector, element());
    return elements.get(selector);
  };
  const draw = [];
  $("#court").getContext = () => new Proxy({}, {
    get: (_, name) => (...args) => { if (name === "fillText") draw.push(args[0]); },
    set: () => true
  });
  $("#surface").value = "hard";
  const touch = ["ArrowUp", " "].map(key => ({ ...element(), dataset: { key } }));
  const window = { listeners: {}, addEventListener(name, callback) { this.listeners[name] = callback; } };
  const document = {
    querySelector: $, querySelectorAll: selector => selector === "[data-key]" ? touch : [],
    addEventListener() {}, createElement: element
  };
  let frame;
  const context = { window, document, performance: { now: () => 0 }, requestAnimationFrame: callback => { frame = callback; } };
  runInNewContext(source("game.js"), context);
  const key = (name, typing = false, repeat = false) => ({
    key: name, repeat, target: { closest: () => typing }, preventDefault() {}
  });
  return { $, window, document, context, touch, draw, key, frame: now => frame(now) };
}
const snapshot = () => ({
  points: [0, 0], games: [0, 0], winner: -1, playerX: 315, playerY: 300,
  opponentX: 165, opponentY: 82, ballX: 315, ballY: 300, vx: 0, vy: 0,
  bounceY: 0, waiting: true, servingFlight: false, bounced: false, lastHitter: 0,
  message: "SPACE TO SERVE"
});

test("Keyboard and touch controls release cleanly and do not consume text entry", () => {
  const ui = browser();
  ui.window.listeners.keydown(ui.key("d", true));
  assert.equal(ui.window.TennisClient.input().x, 0);
  ui.window.listeners.keydown(ui.key("ArrowRight"));
  assert.equal(ui.window.TennisClient.input().x, 1);
  ui.window.listeners.keyup(ui.key("ArrowRight"));
  assert.equal(ui.window.TennisClient.input().x, 0);
  ui.touch[1].listeners.pointerdown({ preventDefault() {}, pointerId: 1 });
  assert.equal(ui.window.TennisClient.input().swing, true);
  ui.touch[1].listeners.pointercancel();
  assert.equal(ui.window.TennisClient.input().swing, false);
  ui.window.listeners.keydown(ui.key("w"));
  ui.window.listeners.blur();
  assert.equal(ui.window.TennisClient.input().y, 0);
});

test("Live snapshots disable solo controls, preserve server scores, and restore practice", () => {
  const ui = browser();
  const state = snapshot(); state.games = [3, 4];
  ui.window.TennisClient.setMatch({
    id: "match", seat: 1, players: [{ name: "Player One" }, { name: "Player Two" }], state
  });
  assert.equal(ui.$("#pause").disabled, true);
  assert.match(ui.$("#match-badge").textContent, /Player Two/);
  ui.window.listeners.keydown(ui.key("n"));
  ui.$("#new-game").listeners.click();
  ui.$("#pause").listeners.click();
  ui.frame(100);
  assert.ok(ui.draw.some(text => text.includes("PLAYER ONE  3")));
  assert.ok(ui.draw.some(text => text.includes("PLAYER TWO  4")));
  assert.ok(!ui.draw.some(text => text.includes("PAUSED")));
  ui.window.TennisClient.setMatch(null);
  ui.frame(200);
  assert.ok(ui.draw.includes("CLUBHOUSE · WAITING"));
  ui.window.TennisClient.practice();
  assert.equal(ui.$("#pause").disabled, false);
  assert.equal(ui.$("#online-controls").hidden, true);
  assert.equal(ui.$("#match-title").textContent, "Practice court");
});

async function lobby(options = {}) {
  const ui = browser();
  ui.$("#lobby-content").hidden = true;
  const calls = [];
  let inputTimer;
  const room = {
    id: "court", name: "<img onerror=alert(1)>", mode: "duel", status: "waiting",
    players: [{ id: "player", name: "<script>name</script>" }], capacity: 2, bracket: [], match: null, champion: null
  };
  if (options.completed) {
    room.status = "complete";
    room.match = { id: "match", seat: 0, players: [{ name: "Player One" }, { name: "Player Two" }], state: { ...snapshot(), winner: 0, games: [6, 2] } };
    room.champion = { id: "player", name: "Player One" };
  }
  const context = {
    ...ui.context, URL, AbortSignal,
    location: { protocol: "http:", hostname: "localhost", origin: "http://localhost:8080" },
    fetch: async (url, config) => {
      calls.push({ url, config });
      let data = url.endsWith("/api/session") ? { token: "test-session", playerId: "player" }
        : url.endsWith("/api/lobby") ? { rooms: [room], playerId: "player" } : room;
      return { ok: !options.fail, status: options.fail ? 503 : 200, json: async () => options.fail ? { error: "Unavailable" } : data };
    },
    setInterval: callback => { inputTimer = callback; },
    setTimeout() {}
  };
  runInNewContext(source("lobby.js"), context);
  const settle = () => new Promise(resolve => setImmediate(resolve));
  const submit = async selector => { ui.$(selector).listeners.submit({ preventDefault() {} }); await settle(); };
  return { ...ui, calls, submit, settle, tick: () => inputTimer() };
}

test("Lobby connects to the real API contract and creates, displays, and leaves a room", async () => {
  const ui = await lobby();
  ui.$("#player-name").value = "Player";
  await ui.submit("#connect-form");
  assert.equal(ui.$("#lobby-content").hidden, false);
  assert.ok(ui.calls.some(call => call.url.endsWith("/api/lobby")));
  assert.equal(ui.calls.find(call => call.url.endsWith("/api/lobby")).config.headers.Authorization, "Bearer " + "test-session");
  ui.$("#room-name").value = "Court";
  ui.$("#room-mode").value = "duel";
  await ui.submit("#create-form");
  assert.equal(ui.$("#active-room-title").textContent, "<img onerror=alert(1)>");
  assert.equal(ui.$("#active-room").hidden, false);
  assert.equal(ui.$("#pause").disabled, true);
  assert.match(ui.$("#roster").children[0].textContent, /<script>name<\/script>/);
  assert.equal(ui.$("#roster").children[0].children.length, 0);
  ui.$("#leave-room").listeners.click();
  await ui.settle();
  assert.ok(ui.calls.some(call => call.url.endsWith("/leave")));
  assert.equal(ui.$("#active-room").hidden, true);
  assert.equal(ui.$("#pause").disabled, false);
});

test("Unsafe server URLs and failed connections do not enter an online session", async () => {
  for (const url of ["http://public.example", "https://" + "user:pass@" + "example.com", "https://example.com/#token", "javascript:alert(1)"]) {
    const ui = await lobby();
    ui.$("#server-url").value = url;
    await ui.submit("#connect-form");
    assert.equal(ui.calls.length, 0);
    assert.match(ui.$("#lobby-status").textContent, /HTTPS/);
  }
  const ui = await lobby({ fail: true });
  await ui.submit("#connect-form");
  assert.equal(ui.$("#lobby-content").hidden, true);
  assert.equal(ui.$("#pause").disabled, false);
  assert.equal(ui.$("#lobby-status").textContent, "Unavailable");
});

test("Completed matches display the champion and final score without posting further inputs", async () => {
  const ui = await lobby({ completed: true });
  await ui.submit("#connect-form");
  ui.$("#room-name").value = "Court"; ui.$("#room-mode").value = "duel";
  await ui.submit("#create-form");
  ui.window.listeners.keydown(ui.key(" "));
  await ui.tick();
  assert.equal(ui.calls.some(call => call.url.endsWith("/input")), false);
  assert.equal(ui.$("#room-status").textContent, "Player One is the champion!");
  assert.match(ui.$("#match-badge").textContent, /^FINAL/);
  ui.frame(100);
  assert.ok(ui.draw.some(text => text.includes("PLAYER ONE  6")));
});

test("Service worker never caches live API responses or third-party requests", () => {
  const listeners = {};
  runInNewContext(source("service-worker.js"), {
    URL, self: {
      location: { origin: "https://tennis.example" }, registration: { scope: "https://tennis.example/" },
      addEventListener: (name, callback) => { listeners[name] = callback; }
    }
  });
  for (const url of ["https://tennis.example/api/lobby", "https://tennis.example/api/rooms/a", "https://tennis.example/health", "https://other.example/game.js"]) {
    let intercepted = false;
    listeners.fetch({ request: { method: "GET", url }, respondWith: () => { intercepted = true; } });
    assert.equal(intercepted, false);
  }
});
