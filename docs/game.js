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
  let game;
  let previous = performance.now();

  function newGame() {
    game = {
      points: [0, 0], games: [0, 0], winner: -1,
      playerX: 315, playerY: 300, opponentX: 165, opponentY: 82,
      ballX: 315, ballY: 300, vx: 0, vy: 0, bounceY: 0,
      waiting: true, servingFlight: false, bounced: false, lastHitter: 0,
      aiDelay: 0, serveDelay: 1.2, cooldown: 0, swung: false, paused: false,
      message: "SPACE TO SERVE"
    };
    pauseButton.textContent = "Pause";
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
  }

  function sprite(x, y, isGenie) {
    x = Math.round(x); y = Math.round(y);
    ctx.fillStyle = "#263b43"; ctx.fillRect(x - 8, y + 4, 16, 4);
    ctx.fillStyle = isGenie ? "#d6a330" : "#80502f"; ctx.fillRect(x - 4, y - 21, 9, 7);
    if (isGenie) ctx.fillRect(x - 8, y - 18, 4, 10);
    ctx.fillStyle = "#f1d2b5"; ctx.fillRect(x - 3, y - 17, 7, 7);
    ctx.fillStyle = isGenie ? "#f6f3df" : "#ef7668"; ctx.fillRect(x - 6, y - 10, 12, 12);
    ctx.fillStyle = "#f1d2b5"; ctx.fillRect(x + 6, y - 8, 8, 3);
    ctx.fillStyle = "#fff"; ctx.fillRect(x - 6, y + 2, 4, 6); ctx.fillRect(x + 3, y + 2, 4, 6);
    ctx.fillStyle = "#183b86"; ctx.fillRect(x - 6, y + 7, 5, 3); ctx.fillRect(x + 3, y + 7, 5, 3);
    ctx.strokeStyle = "#fff"; ctx.strokeRect(x + 14, y - 16, 9, 12);
    ctx.beginPath(); ctx.moveTo(x + 15, y - 3); ctx.lineTo(x + 11, y); ctx.stroke();
  }

  function draw() {
    ctx.fillStyle = "#0c1d2d"; ctx.fillRect(0, 0, 480, 360);
    ctx.fillStyle = "#f2dc7d"; ctx.font = "bold 13px monospace"; ctx.fillText("GENIE BOUCHARD TENNIS", 144, 20);
    ctx.fillStyle = "#fff"; ctx.font = "bold 8px monospace";
    ctx.fillText(`GENIE  ${game.games[0]}  ${pointLabel(0)}`, 45, 45);
    ctx.fillText(`${profiles[opponentSelect.selectedIndex].name.toUpperCase()}  ${game.games[1]}  ${pointLabel(1)}`, 250, 45);
    ctx.fillStyle = "#6e8f72"; ctx.fillRect(25, 55, 430, 272);
    ctx.fillStyle = "#32845b"; ctx.fillRect(court.left, court.top, court.right - court.left, court.bottom - court.top);
    ctx.strokeStyle = "#f6f3df"; ctx.lineWidth = 2; ctx.strokeRect(court.left, court.top, court.right - court.left, court.bottom - court.top);
    ctx.strokeRect(65, court.top, 350, court.bottom - court.top);
    ctx.strokeRect(65, 132, 350, 118);
    ctx.beginPath(); ctx.moveTo(240, 132); ctx.lineTo(240, 250); ctx.stroke();
    ctx.fillStyle = "#f6f3df"; ctx.fillRect(30, court.net - 2, 420, 4);
    for (let x = 30; x < 450; x += 8) ctx.fillRect(x, court.net + 2, 2, 7);
    sprite(game.opponentX, game.opponentY, false);
    sprite(game.playerX, game.playerY, true);
    ctx.fillStyle = "#536c36"; ctx.fillRect(game.ballX - 2, game.ballY + 4, 6, 2);
    ctx.fillStyle = "#ffed42"; ctx.fillRect(game.ballX - 2, game.ballY - 2, 5, 5);
    ctx.fillStyle = "#ffed42"; ctx.fillText(game.paused ? "PAUSED · P TO RESUME" : game.message, 45, 66);
    ctx.fillStyle = "#fff"; ctx.fillText("ARROWS/WASD MOVE · SPACE SERVE/HIT · LEFT/RIGHT AIM", 45, 344);
    ctx.fillStyle = "#f2dc7d"; ctx.fillText("CAN · EUGENIE BOUCHARD · PLAY A SET", 45, 357);
  }

  function frame(now) {
    update((now - previous) / 1000);
    previous = now;
    draw();
    requestAnimationFrame(frame);
  }

  window.addEventListener("keydown", event => {
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if ([" ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(key)) event.preventDefault();
    if ((key === "p" || key === "n") && !event.repeat) {
      if (key === "p") {
        game.paused = !game.paused;
        pauseButton.textContent = game.paused ? "Resume" : "Pause";
      } else newGame();
    }
    keys.add(key);
  });
  window.addEventListener("keyup", event => keys.delete(event.key.length === 1 ? event.key.toLowerCase() : event.key));
  window.addEventListener("blur", () => keys.clear());
  document.querySelector("#new-game").addEventListener("click", newGame);
  pauseButton.addEventListener("click", () => {
    game.paused = !game.paused;
    pauseButton.textContent = game.paused ? "Resume" : "Pause";
  });
  opponentSelect.addEventListener("change", newGame);
  newGame();
  requestAnimationFrame(frame);
})();
