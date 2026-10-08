(() => {
  "use strict";

  const canvas = document.querySelector("#court");
  const ctx = canvas.getContext("2d");
  const opponentSelect = document.querySelector("#opponent");
  const pauseButton = document.querySelector("#pause");
  const profiles = [
    { name: "Rookie", speed: 78, reach: 18, shot: 140 },
    { name: "Club Champion", speed: 105, reach: 20, shot: 165 },
    { name: "Tour Challenger", speed: 125, reach: 22, shot: 185 }
  ];
  const genie = { speed: 155, reach: 27, shot: 210 };
  const court = { left: 45, right: 435, top: 72, bottom: 310, net: 191 };
  const keys = new Set();
  const swingEdges = [];
  function changeKey(key, pressed) {
    const wasSwinging = keys.has(" ");
    if (pressed) keys.add(key); else keys.delete(key);
    if (key === " " && keys.has(" ") !== wasSwinging) {
      swingEdges.push(pressed);
      if (swingEdges.length > 16) swingEdges.shift();
    }
  }
  function clearInput() { changeKey(" ", false); keys.clear(); }
  let game;
  let previous = performance.now();
  let online = false;
  let onlineMatch = null;
  let animationTime = 0;
  let swingUntil = 0;
  let lastPositions = [315, 300, 165, 82];
  let motion = [false, false];
  const motionUntil = [0, 0];
  const renderKeys = ["playerX", "playerY", "opponentX", "opponentY", "ballX", "ballY"];
  let interpolation = null;
  const trail = [];
  const surfaces = {
    hard: { surround: "#365868", base: "#247ca0", stripe: "#287f9f" },
    grass: { surround: "#52775b", base: "#31845a", stripe: "#398d62" },
    clay: { surround: "#74614c", base: "#ba6844", stripe: "#c2714c" }
  };

  function newGame() {
    if (online) return;
    game = {
      points: [0, 0], games: [0, 0], winner: -1,
      playerX: 315, playerY: 300, opponentX: 165, opponentY: 82,
      ballX: 315, ballY: 300, vx: 0, vy: 0, bounceY: 0,
      waiting: true, servingFlight: false, bounced: false, lastHitter: 0,
      aiDelay: 0, serveDelay: 1.2, cooldown: 0, swung: false, paused: false,
      message: "SPACE TO SERVE"
    };
    pauseButton.textContent = "Pause";
    trail.length = 0;
    servePositions();
  }

  function tieBreak() { return game.games[0] === 6 && game.games[1] === 6; }
  function server() {
    return tieBreak() ? (12 + Math.floor((game.points[0] + game.points[1] + 1) / 2)) % 2
      : (game.games[0] + game.games[1]) % 2;
  }
  function servingRight() { return (game.points[0] + game.points[1]) % 2 === 0; }

  function servePositions() {
    game.playerX = servingRight() ? 315 : 165;
    game.opponentX = servingRight() ? 165 : 315;
    game.playerY = court.bottom - 10;
    game.opponentY = court.top + 10;
    game.waiting = true;
    game.servingFlight = false;
    game.bounced = false;
    game.serveDelay = 1.2;
    game.vx = game.vy = 0;
    game.ballX = server() === 0 ? game.playerX : game.opponentX;
    game.ballY = server() === 0 ? game.playerY : game.opponentY;
    game.message = game.winner >= 0
      ? (game.winner === 0 ? "GENIE WINS!" : `${profiles[opponentSelect.selectedIndex].name.toUpperCase()} WINS`)
      : (server() === 0 ? "SPACE TO SERVE" : "OPPONENT SERVING");
  }

  function point(wonBy, reason) {
    game.points[wonBy]++;
    const target = tieBreak() ? 7 : 4;
    if (game.points[wonBy] >= target && game.points[wonBy] - game.points[1 - wonBy] >= 2) {
      const wasTieBreak = tieBreak();
      game.games[wonBy]++;
      game.points = [0, 0];
      if (wasTieBreak || (game.games[wonBy] >= 6 && game.games[wonBy] - game.games[1 - wonBy] >= 2))
        game.winner = wonBy;
    }
    servePositions();
    if (game.winner < 0) game.message = `${reason}: ${wonBy === 0 ? "GENIE" : profiles[opponentSelect.selectedIndex].name.toUpperCase()} · ${game.message}`;
  }

  function pointLabel(player) {
    if (tieBreak()) return String(game.points[player]);
    if (game.points[0] >= 3 && game.points[1] >= 3)
      return game.points[player] > game.points[1 - player] ? "AD" : "40";
    return ["0", "15", "30", "40"][Math.min(game.points[player], 3)];
  }

  function moveTowards(current, target, amount) {
    return current + Math.max(-amount, Math.min(target - current, amount));
  }

  function hit(player, targetX) {
    game.lastHitter = player;
    game.servingFlight = game.bounced = false;
    game.bounceY = player === 0 ? court.top + 32 : court.bottom - 32;
    const dx = targetX - game.ballX;
    const dy = game.bounceY - game.ballY;
    const distance = Math.hypot(dx, dy);
    const speed = player === 0 ? genie.shot : profiles[opponentSelect.selectedIndex].shot;
    game.vx = dx / distance * speed;
    game.vy = dy / distance * speed;
    game.aiDelay = 0.16;
  }

  function startServe() {
    game.waiting = false;
    game.servingFlight = true;
    game.bounced = false;
    game.lastHitter = server();
    game.bounceY = game.lastHitter === 0 ? court.net - 43 : court.net + 43;
    const targetX = servingRight() === (game.lastHitter === 0) ? 180 : 300;
    const speed = game.lastHitter === 0 ? genie.shot : profiles[opponentSelect.selectedIndex].shot;
    const dx = targetX - game.ballX;
    const dy = game.bounceY - game.ballY;
    const distance = Math.hypot(dx, dy);
    game.vx = dx / distance * speed;
    game.vy = dy / distance * speed;
    game.aiDelay = 0.12;
    game.message = "RALLY · SPACE TO HIT";
  }

  function update(seconds) {
    if (online) return;
    if (game.paused || game.winner >= 0) return;
    seconds = Math.min(seconds, 0.05);
    const moveX = Number(keys.has("ArrowRight") || keys.has("d")) - Number(keys.has("ArrowLeft") || keys.has("a"));
    const moveY = Number(keys.has("ArrowDown") || keys.has("s")) - Number(keys.has("ArrowUp") || keys.has("w"));
    const swing = keys.has(" ");
    const length = Math.hypot(moveX, moveY) || 1;

    if (!game.waiting) {
      game.playerX = Math.max(court.left, Math.min(court.right, game.playerX + moveX / length * genie.speed * seconds));
      game.playerY = Math.max(court.net + 18, Math.min(court.bottom, game.playerY + moveY / length * genie.speed * seconds));
    }
    game.cooldown = Math.max(0, game.cooldown - seconds);
    const newSwing = swing && !game.swung && game.cooldown === 0;
    game.swung = swing;
    if (game.waiting) {
      game.serveDelay -= seconds;
      if ((server() === 0 && newSwing) || (server() === 1 && game.serveDelay <= 0)) startServe();
      return;
    }

    const opponent = profiles[opponentSelect.selectedIndex];
    game.aiDelay -= seconds;
    if (game.aiDelay <= 0) {
      const targetX = game.lastHitter === 0
        ? game.ballX + game.vx * Math.max(0, (112 - game.ballY) / game.vy)
        : 240;
      game.opponentX = moveTowards(game.opponentX, Math.max(court.left, Math.min(court.right, targetX)), opponent.speed * seconds);
      game.opponentY = moveTowards(game.opponentY, game.lastHitter === 0 ? 112 : court.top + 10, opponent.speed * seconds);
    }

    game.ballX += game.vx * seconds;
    game.ballY += game.vy * seconds;
    if (!game.bounced && (game.vy > 0 ? game.ballY >= game.bounceY : game.ballY <= game.bounceY)) {
      game.bounced = true;
      const landingLeft = servingRight() === (game.lastHitter === 0);
      const minX = game.servingFlight && !landingLeft ? 240 : court.left;
      const maxX = game.servingFlight && landingLeft ? 240 : court.right;
      if (game.ballX < minX || game.ballX > maxX) {
        point(1 - game.lastHitter, "OUT");
        return;
      }
    }
    if (game.lastHitter === 1 && game.bounced && newSwing &&
        Math.hypot(game.ballX - game.playerX, game.ballY - game.playerY) <= genie.reach) {
      hit(0, moveX < 0 ? 100 : moveX > 0 ? 380 : 150 + Math.random() * 180);
    } else if (game.lastHitter === 0 && game.bounced &&
        Math.hypot(game.ballX - game.opponentX, game.ballY - game.opponentY) <= opponent.reach) {
      hit(1, 80 + Math.random() * 320);
    }
    if (game.ballY < court.top - 24 || game.ballY > court.bottom + 24 ||
        game.ballX < court.left - 50 || game.ballX > court.right + 50)
      point(game.lastHitter, "POINT");
    if (newSwing) game.cooldown = 0.18;
    if (newSwing) swingUntil = animationTime + 0.2;
  }

  function sprite(x, y, isGenie, moving, selected) {
    x = Math.round(x); y = Math.round(y);
    const stride = moving ? Math.round(Math.sin(animationTime * 18) * 3) : 0;
    const swinging = selected && animationTime < swingUntil;
    ctx.save();
    ctx.translate(x, y);
    if (selected) {
      ctx.strokeStyle = "#ffe092"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(0, 5, 13, 4, 0, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.fillStyle = "#122b3a70";
    ctx.beginPath(); ctx.ellipse(1, 5, 11, 3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = isGenie ? "#f2ceac" : "#b87c58";
    ctx.fillRect(-6, -1, 4, 7 + stride); ctx.fillRect(3, -1, 4, 7 - stride);
    ctx.fillStyle = "#faf7ea";
    ctx.fillRect(-6, 4 + stride, 4, 4); ctx.fillRect(3, 4 - stride, 4, 4);
    ctx.fillStyle = "#1c304e";
    ctx.fillRect(-7, 8 + stride, 6, 3); ctx.fillRect(3, 8 - stride, 6, 3);
    ctx.fillStyle = isGenie ? "#f5f3df" : "#e56762";
    ctx.fillRect(-7, -17, 14, 14);
    ctx.fillStyle = isGenie ? "#56a4bf" : "#213d63";
    ctx.fillRect(-7, -5, 14, 5);
    ctx.fillStyle = isGenie ? "#c7e6eb" : "#f7af8b";
    ctx.fillRect(-6, -16, 3, 9);
    ctx.fillStyle = isGenie ? "#f2ceac" : "#b87c58";
    ctx.fillRect(-10, -14, 3, 10);
    ctx.fillRect(7, -14, swinging ? 12 : 6, 3);
    ctx.fillRect(-4, -25, 8, 8);
    ctx.fillStyle = isGenie ? "#c99432" : "#402d28";
    ctx.fillRect(-5, -28, 10, 5);
    if (isGenie) ctx.fillRect(-8, -25, 4, 10);
    if (!isGenie) ctx.fillRect(-5, -25, 10, 5);
    ctx.fillStyle = "#fff"; ctx.fillRect(-5, -24, 10, 2);
    if (isGenie) { ctx.fillStyle = "#384354"; ctx.fillRect(-3, -22, 1, 1); ctx.fillRect(2, -22, 1, 1); }
    ctx.save(); ctx.translate(swinging ? 19 : 12, -12); ctx.rotate(swinging ? 1.1 : -0.35);
    ctx.fillStyle = "#dedbd0"; ctx.fillRect(-1, -4, 2, 10);
    ctx.strokeStyle = "#edf5f7"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(0, -10, 5, 7, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = "#d7e7ee88"; ctx.lineWidth = 0.5;
    for (let i = -3; i <= 3; i += 3) {
      ctx.beginPath(); ctx.moveTo(i, -15); ctx.lineTo(i, -5); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-4, -10 + i); ctx.lineTo(4, -10 + i); ctx.stroke();
    }
    ctx.restore(); ctx.restore();
  }

  function draw() {
    ctx.fillStyle = "#101c2c"; ctx.fillRect(0, 0, 480, 360);
    ctx.fillStyle = "#26364b"; ctx.fillRect(12, 5, 456, 47);
    ctx.fillStyle = "#f2dc7d"; ctx.font = "bold 13px monospace"; ctx.fillText("CENTRE COURT", 185, 22);
    ctx.fillStyle = "#fff"; ctx.font = "bold 8px monospace";
    const names = onlineMatch ? onlineMatch.players.map(p => p.name.toUpperCase().slice(0, 18)) : ["GENIE", profiles[opponentSelect.selectedIndex].name.toUpperCase()];
    ctx.fillText(`${names[0]}  ${game.games[0]}  ${pointLabel(0)}`, 24, 43);
    ctx.fillText(`${names[1]}  ${game.games[1]}  ${pointLabel(1)}`, 253, 43);
    const surface = surfaces[document.querySelector("#surface").value];
    ctx.fillStyle = surface.surround; ctx.fillRect(25, 55, 430, 272);
    for (let row = 0; row < 12; row++) {
      for (const x of [5, 462]) {
        ctx.fillStyle = row % 3 === 0 ? "#daa35b" : row % 3 === 1 ? "#bac9da" : "#b46b70";
        ctx.fillRect(x, 75 + row * 20, 10, 8);
        ctx.fillStyle = "#31475f"; ctx.fillRect(x, 83 + row * 20, 10, 5);
      }
    }
    ctx.fillStyle = surface.base; ctx.fillRect(court.left, court.top, court.right - court.left, court.bottom - court.top);
    ctx.fillStyle = surface.stripe;
    for (let y = court.top; y < court.bottom; y += 40) ctx.fillRect(court.left, y, court.right - court.left, 20);
    ctx.strokeStyle = "#f6f3df"; ctx.lineWidth = 2; ctx.strokeRect(court.left, court.top, court.right - court.left, court.bottom - court.top);
    ctx.strokeRect(65, court.top, 350, court.bottom - court.top);
    ctx.strokeRect(65, 132, 350, 118);
    ctx.beginPath(); ctx.moveTo(240, 132); ctx.lineTo(240, 250); ctx.stroke();
    sprite(game.opponentX, game.opponentY, false, motion[1], online ? onlineMatch?.seat === 1 : false);
    ctx.fillStyle = "#10273460"; ctx.fillRect(30, court.net, 420, 10);
    ctx.strokeStyle = "#c8d9d880"; ctx.lineWidth = 0.5;
    for (let x = 30; x < 450; x += 6) { ctx.beginPath(); ctx.moveTo(x, court.net); ctx.lineTo(x, court.net + 9); ctx.stroke(); }
    for (let y = court.net; y < court.net + 10; y += 3) { ctx.beginPath(); ctx.moveTo(30, y); ctx.lineTo(450, y); ctx.stroke(); }
    ctx.fillStyle = "#f6f3df"; ctx.fillRect(30, court.net - 2, 420, 2);
    ctx.fillStyle = "#24374a"; ctx.fillRect(28, court.net - 4, 3, 17); ctx.fillRect(449, court.net - 4, 3, 17);
    sprite(game.playerX, game.playerY, true, motion[0], online ? onlineMatch?.seat === 0 : true);
    trail.forEach((p, i) => {
      ctx.fillStyle = `rgba(255,237,66,${i / trail.length * 0.3})`;
      ctx.fillRect(p.x - 1, p.y - 1, 3, 3);
    });
    ctx.fillStyle = "#536c36"; ctx.fillRect(game.ballX - 2, game.ballY + 4, 6, 2);
    ctx.fillStyle = "#ffed42"; ctx.beginPath(); ctx.arc(game.ballX, game.ballY - 2, 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#fffbb5"; ctx.fillRect(game.ballX - 1, game.ballY - 4, 2, 1);
    ctx.fillStyle = "#ffed42"; ctx.fillText(game.paused ? "PAUSED · P TO RESUME" : game.message.slice(0, 70), 30, 66);
    ctx.fillStyle = "#fff"; ctx.fillText("ARROWS/WASD MOVE · SPACE SERVE/HIT · LEFT/RIGHT AIM", 45, 344);
    ctx.fillStyle = "#f2dc7d"; ctx.fillText(online ? "LIVE MATCH · EQUAL STATS · SERVER-VERIFIED SCORE" : "CAN · EUGENIE BOUCHARD · ARCADE TOUR", 45, 357);
    if (online && !onlineMatch) {
      ctx.fillStyle = "#101c2cdd"; ctx.fillRect(90, 150, 300, 70);
      ctx.fillStyle = "#f2dc7d"; ctx.font = "bold 13px monospace";
      ctx.fillText("CLUBHOUSE · WAITING", 160, 180);
      ctx.font = "8px monospace"; ctx.fillText("Your roster and bracket are in the lobby above.", 110, 201);
    }
  }

  function frame(now) {
    animationTime = now / 1000;
    update((now - previous) / 1000);
    if (online && interpolation) {
      const fraction = Math.min(1, (animationTime - interpolation.started) / 0.1);
      for (const key of renderKeys)
        game[key] = interpolation.from[key] + (interpolation.to[key] - interpolation.from[key]) * fraction;
    }
    const positions = [game.playerX, game.playerY, game.opponentX, game.opponentY];
    for (let seat = 0; seat < 2; seat++) {
      if (Math.hypot(positions[seat * 2] - lastPositions[seat * 2], positions[seat * 2 + 1] - lastPositions[seat * 2 + 1]) > 0.1)
        motionUntil[seat] = animationTime + 0.12;
    }
    motion = motionUntil.map(until => until > animationTime);
    lastPositions = positions;
    if (!game.waiting && !game.paused && (!online || onlineMatch)) {
      trail.push({ x: game.ballX, y: game.ballY });
      if (trail.length > 6) trail.shift();
    } else trail.length = 0;
    previous = now;
    draw();
    requestAnimationFrame(frame);
  }

  window.addEventListener("keydown", event => {
    if (event.target.closest("input, select, button, textarea")) return;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if ([" ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(key)) event.preventDefault();
    if (!online && (key === "p" || key === "n") && !event.repeat) {
      if (key === "p") {
        game.paused = !game.paused;
        pauseButton.textContent = game.paused ? "Resume" : "Pause";
      } else newGame();
    }
    changeKey(key, true);
    if (key === " " && !event.repeat) swingUntil = animationTime + 0.2;
  });
  window.addEventListener("keyup", event => changeKey(event.key.length === 1 ? event.key.toLowerCase() : event.key, false));
  window.addEventListener("blur", () => {
    clearInput();
    if (!online) { game.paused = true; pauseButton.textContent = "Resume"; }
  });
  document.addEventListener("visibilitychange", () => { if (document.hidden) clearInput(); });
  document.querySelector("#new-game").addEventListener("click", () => { newGame(); canvas.focus(); });
  pauseButton.addEventListener("click", () => {
    if (online) return;
    game.paused = !game.paused;
    pauseButton.textContent = game.paused ? "Resume" : "Pause";
    canvas.focus();
  });
  opponentSelect.addEventListener("change", newGame);
  document.querySelector("#fullscreen").addEventListener("click", async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.querySelector(".game").requestFullscreen();
    } catch { /* Full screen is optional on unsupported browsers. */ }
  });
  document.querySelectorAll("[data-key]").forEach(button => {
    button.addEventListener("pointerdown", event => {
      event.preventDefault(); button.setPointerCapture(event.pointerId);
      changeKey(button.dataset.key, true);
      if (button.dataset.key === " ") swingUntil = animationTime + 0.2;
    });
    for (const event of ["pointerup", "pointercancel", "lostpointercapture"])
      button.addEventListener(event, () => changeKey(button.dataset.key, false));
  });
  window.TennisClient = {
    takeSwingEdges: () => swingEdges.splice(0),
    input: () => ({
      x: Number(keys.has("ArrowRight") || keys.has("d")) - Number(keys.has("ArrowLeft") || keys.has("a")),
      y: Number(keys.has("ArrowDown") || keys.has("s")) - Number(keys.has("ArrowUp") || keys.has("w")),
      swing: keys.has(" ")
    }),
    setMatch(match) {
      online = true;
      const changed = onlineMatch?.id !== match?.id;
      if (changed) { clearInput(); swingEdges.length = 0; trail.length = 0; }
      const from = Object.fromEntries(renderKeys.map(key => [key, game[key]]));
      interpolation = match && !changed && !match.state.waiting && match.state.winner < 0
        ? { from, to: { ...match.state }, started: animationTime } : null;
      onlineMatch = match;
      if (match) game = { ...match.state, paused: false };
      opponentSelect.disabled = pauseButton.disabled = document.querySelector("#new-game").disabled = true;
      document.querySelector("#online-controls").hidden = false;
      document.querySelector("#match-title").textContent = match ? `${match.players[0].name} vs ${match.players[1].name}` : "Tournament / match waiting room";
      document.querySelector("#match-badge").textContent = match
        ? `${match.state.winner >= 0 ? "FINAL" : "LIVE"} · YOU: ${match.players[match.seat].name}` : "WAITING FOR YOUR MATCH";
    },
    practice() {
      online = false; onlineMatch = null; interpolation = null; clearInput(); swingEdges.length = 0;
      opponentSelect.disabled = pauseButton.disabled = document.querySelector("#new-game").disabled = false;
      document.querySelector("#online-controls").hidden = true;
      document.querySelector("#match-title").textContent = "Practice court";
      document.querySelector("#match-badge").textContent = "SOLO · ONE SET";
      newGame();
    }
  };
  newGame();
  requestAnimationFrame(frame);
})();
