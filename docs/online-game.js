(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.OnlineTennis = api;
})(typeof window === "undefined" ? null : window, function () {
  "use strict";
  const court = Object.freeze({ left: 45, right: 435, top: 72, bottom: 310, net: 191 });
  const stats = Object.freeze({ speed: 155, reach: 27, shot: 210 });
  const neutral = Object.freeze({ x: 0, y: 0, swing: false });
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function tieBreak(state) { return state.games[0] === 6 && state.games[1] === 6; }
  function server(state) {
    return tieBreak(state)
      ? Math.floor((state.points[0] + state.points[1] + 1) / 2) % 2
      : (state.games[0] + state.games[1]) % 2;
  }
  function servingRight(state) { return (state.points[0] + state.points[1]) % 2 === 0; }

  function servePositions(state) {
    state.playerX = servingRight(state) ? 315 : 165;
    state.opponentX = servingRight(state) ? 165 : 315;
    state.playerY = court.bottom - 10;
    state.opponentY = court.top + 10;
    state.waiting = true;
    state.servingFlight = state.bounced = false;
    state.vx = state.vy = 0;
    state.ballX = server(state) === 0 ? state.playerX : state.opponentX;
    state.ballY = server(state) === 0 ? state.playerY : state.opponentY;
    state.message = state.winner >= 0 ? `PLAYER ${state.winner + 1} WINS`
      : `PLAYER ${server(state) + 1} TO SERVE`;
  }

  function createState() {
    const state = {
      points: [0, 0], games: [0, 0], winner: -1,
      playerX: 315, playerY: 300, opponentX: 165, opponentY: 82,
      ballX: 315, ballY: 300, vx: 0, vy: 0, bounceY: 0,
      waiting: true, servingFlight: false, bounced: false, lastHitter: 0,
      cooldowns: [0, 0], swung: [false, false], message: ""
    };
    servePositions(state);
    return state;
  }

  function awardPoint(state, seat, reason = "POINT") {
    if (state.winner >= 0 || (seat !== 0 && seat !== 1)) return state;
    const wasTieBreak = tieBreak(state);
    state.points[seat]++;
    if (state.points[seat] >= (wasTieBreak ? 7 : 4) &&
        state.points[seat] - state.points[1 - seat] >= 2) {
      state.games[seat]++;
      state.points = [0, 0];
      if (wasTieBreak || (state.games[seat] >= 6 && state.games[seat] - state.games[1 - seat] >= 2))
        state.winner = seat;
    }
    servePositions(state);
    if (state.winner < 0) state.message = `${reason}: PLAYER ${seat + 1} · ${state.message}`;
    return state;
  }

  function pointLabel(state, seat) {
    if (tieBreak(state)) return String(state.points[seat]);
    if (state.points[0] >= 3 && state.points[1] >= 3)
      return state.points[seat] > state.points[1 - seat] ? "AD" : "40";
    return ["0", "15", "30", "40"][Math.min(state.points[seat], 3)];
  }

  function launch(state, seat, targetX, serving) {
    state.waiting = false;
    state.lastHitter = seat;
    state.servingFlight = serving;
    state.bounced = false;
    state.bounceY = serving ? court.net + (seat === 0 ? -43 : 43)
      : (seat === 0 ? court.top + 32 : court.bottom - 32);
    const dx = targetX - state.ballX;
    const dy = state.bounceY - state.ballY;
    const distance = Math.hypot(dx, dy) || 1;
    state.vx = dx / distance * stats.shot;
    state.vy = dy / distance * stats.shot;
    state.message = "RALLY · SWING TO HIT";
  }

  function step(state, inputs = [neutral, neutral], seconds = 1 / 60) {
    if (state.winner >= 0) return state;
    const dt = clamp(Number.isFinite(seconds) ? seconds : 0, 0, 0.05);
    const swings = [false, false];
    for (let seat = 0; seat < 2; seat++) {
      const input = inputs[seat] || neutral;
      const x = clamp(Number.isFinite(input.x) ? input.x : 0, -1, 1);
      const y = clamp(Number.isFinite(input.y) ? input.y : 0, -1, 1);
      const length = Math.max(1, Math.hypot(x, y));
      state.cooldowns[seat] = Math.max(0, state.cooldowns[seat] - dt);
      swings[seat] = !!input.swing && !state.swung[seat] && state.cooldowns[seat] === 0;
      state.swung[seat] = !!input.swing;
      if (!state.waiting) {
        const xKey = seat === 0 ? "playerX" : "opponentX";
        const yKey = seat === 0 ? "playerY" : "opponentY";
        state[xKey] = clamp(state[xKey] + x / length * stats.speed * dt, court.left, court.right);
        state[yKey] = clamp(state[yKey] + y / length * stats.speed * dt,
          seat === 0 ? court.net + 18 : court.top, seat === 0 ? court.bottom : court.net - 18);
      }
      if (swings[seat]) state.cooldowns[seat] = 0.18;
    }
    if (state.waiting) {
      const seat = server(state);
      if (swings[seat]) launch(state, seat, servingRight(state) === (seat === 0) ? 180 : 300, true);
      return state;
    }
    state.ballX += state.vx * dt;
    state.ballY += state.vy * dt;
    if (!state.bounced && (state.vy > 0 ? state.ballY >= state.bounceY : state.ballY <= state.bounceY)) {
      state.bounced = true;
      const landingLeft = servingRight(state) === (state.lastHitter === 0);
      const minX = state.servingFlight && !landingLeft ? 240 : court.left;
      const maxX = state.servingFlight && landingLeft ? 240 : court.right;
      if (state.ballX < minX || state.ballX > maxX) return awardPoint(state, 1 - state.lastHitter, "OUT");
    }
    const receiver = 1 - state.lastHitter;
    if (state.bounced && swings[receiver] &&
        Math.hypot(state.ballX - (receiver === 0 ? state.playerX : state.opponentX),
          state.ballY - (receiver === 0 ? state.playerY : state.opponentY)) <= stats.reach) {
      const aim = (inputs[receiver] || neutral).x || 0;
      launch(state, receiver, aim < 0 ? 100 : aim > 0 ? 380 : 240, false);
    }
    if (state.ballY < court.top - 24 || state.ballY > court.bottom + 24 ||
        state.ballX < court.left - 50 || state.ballX > court.right + 50)
      awardPoint(state, state.lastHitter, "POINT");
    return state;
  }

  function forfeit(state, seat, reason = "FORFEIT") {
    if (state.winner < 0) {
      state.winner = 1 - seat;
      state.vx = state.vy = 0;
      state.message = `${reason}: PLAYER ${state.winner + 1} WINS`;
    }
    return state;
  }
  return Object.freeze({ court, stats, createState, step, awardPoint, pointLabel, server, tieBreak, forfeit });
});
