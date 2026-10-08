(() => {
  "use strict";
  const $ = selector => document.querySelector(selector);
  let connection = null;
  let roomId = null;
  let currentMatch = null;
  let rooms = [];
  let filter = "all";
  let generation = 0;
  let busy = false;
  let roomMarkup = "";
  let inputPending = false;
  const swingEdges = [];
  let inputMatchId = null;

  const status = message => { $("#lobby-status").textContent = message; };
  const initialUrl = /^https?:$/.test(location.protocol) && !/(^|\.)github\.io$/i.test(location.hostname)
    ? location.origin : "";
  $("#server-url").value = initialUrl;

  function serverUrl(value) {
    const url = new URL(value);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.username || url.password || url.search || url.hash ||
        (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
        (location.protocol === "https:" && url.protocol !== "https:"))
      throw new Error("Use an HTTPS server URL (HTTP is supported only for local development on an HTTP page).");
    return url.href.replace(/\/$/, "");
  }

  async function request(path, method = "GET", body, target = connection) {
    if (!target) throw new Error("Connect to a server first.");
    const response = await fetch(`${target.url}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(target.token ? { Authorization: "Bearer " + target.token } : {})
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
      credentials: "omit",
      referrerPolicy: "no-referrer"
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Server returned ${response.status}.`);
    return data;
  }

  function reset() {
    generation++;
    connection = null; roomId = null; currentMatch = null;
    rooms = []; roomMarkup = ""; swingEdges.length = 0; inputMatchId = null;
    $("#connect").hidden = false;
    $("#disconnect").hidden = true;
    $("#player-name").disabled = $("#server-url").disabled = false;
    $("#lobby-content").hidden = $("#active-room").hidden = true;
    $("#connection-badge").textContent = "OFFLINE PRACTICE";
    $("#connection-badge").classList.remove("connected");
    window.TennisClient.practice();
  }

  function cell(row, text) {
    const td = document.createElement("td"); td.textContent = text; row.append(td); return td;
  }

  function renderRooms() {
    const list = $("#room-list");
    list.replaceChildren();
    const visible = rooms.filter(room => filter === "all" || room.mode === filter);
    if (!visible.length) {
      const row = document.createElement("tr");
      cell(row, "No courts yet. Create one and invite players to this server.").colSpan = 5;
      list.append(row);
    }
    for (const room of visible) {
      const row = document.createElement("tr");
      cell(row, room.name);
      cell(row, room.mode === "tournament" ? "8-player knockout" : "Heads-up");
      cell(row, `${room.players.length} / ${room.capacity}`);
      cell(row, room.status === "waiting" ? "Registering" : ["complete", "finished"].includes(room.status) ? "Complete" : "In play");
      const button = document.createElement("button");
      button.type = "button"; button.textContent = "Join";
      button.disabled = busy || Boolean(roomId) || room.status !== "waiting" || room.players.length >= room.capacity;
      button.addEventListener("click", () => action(async () => {
        const data = await request(`/api/rooms/${encodeURIComponent(room.id)}/join`, "POST", {});
        roomId = data.id || room.id;
        roomMarkup = "";
        renderRoom(await request(`/api/rooms/${encodeURIComponent(roomId)}`));
      }));
      cell(row, "").append(button);
      list.append(row);
    }
    $("#create-room").disabled = busy || Boolean(roomId);
  }

  function renderRoom(room) {
    currentMatch = room.match;
    window.TennisClient.setMatch(room.match);
    $("#active-room").hidden = false;
    $("#active-room-title").textContent = room.name;
    const completed = room.match && room.match.state.winner >= 0;
    $("#room-status").textContent = room.champion ? `${room.champion.name} is the champion!`
      : room.status === "waiting" ? `${room.players.length} of ${room.capacity} seats filled. Play starts automatically when full.`
      : completed ? `${room.match.players[room.match.state.winner].name} won your match. Follow the bracket for the next round.`
      : room.match ? `Live match · You control ${room.match.seat === 0 ? "the lower" : "the upper"} player.`
      : "Your match has ended. Follow the bracket for the next round or final result.";
    const markup = JSON.stringify([room.players, room.bracket, room.champion]);
    if (markup === roomMarkup) return;
    roomMarkup = markup;
    $("#roster").replaceChildren();
    for (let i = 0; i < room.capacity; i++) {
      const player = room.players[i];
      const seat = document.createElement("li");
      seat.textContent = player ? `${i + 1}. ${player.name}${player.id === connection.playerId ? " (you)" : ""}` : `${i + 1}. Open seat`;
      seat.className = !player ? "empty-seat" : player.id === connection.playerId ? "you" : "";
      $("#roster").append(seat);
    }
    $("#bracket").replaceChildren();
    if (room.mode !== "tournament") return;
    const rounds = [...new Set(room.bracket.map(match => match.round))].sort((a, b) => a - b);
    rounds.forEach((round, roundIndex) => {
      const column = document.createElement("section");
      const heading = document.createElement("h4");
      heading.textContent = ["Quarterfinals", "Semifinals", "Final"][roundIndex] || `Round ${round}`;
      column.append(heading);
      room.bracket.filter(match => match.round === round).forEach(match => {
        const card = document.createElement("div"); card.className = "bracket-match";
        match.players.forEach(player => {
          const p = document.createElement("p");
          p.textContent = player ? player.name : "Awaiting winner";
          if (player && player.id === match.winnerId) p.className = "winner";
          card.append(p);
        });
        const label = document.createElement("small"); label.textContent = match.status; card.append(label);
        column.append(card);
      });
      $("#bracket").append(column);
    });
  }

  async function action(work) {
    if (busy) return;
    busy = true;
    const epoch = generation;
    renderRooms();
    try { await work(); }
    catch (error) { if (epoch === generation) status(error.message); }
    finally { busy = false; renderRooms(); }
  }

  async function poll(epoch) {
    let failures = 0;
    let lastLobby = 0;
    while (connection && epoch === generation) {
      try {
        if (Date.now() - lastLobby > 2000) {
          const data = await request("/api/lobby");
          if (epoch !== generation) return;
          rooms = data.rooms; renderRooms(); lastLobby = Date.now();
        }
        if (roomId && !busy) {
          const requestedRoom = roomId;
          const room = await request(`/api/rooms/${encodeURIComponent(requestedRoom)}`);
          if (epoch !== generation) return;
          if (roomId === requestedRoom) renderRoom(room);
        }
        if (failures) status("Connection restored.");
        failures = 0;
      } catch (error) {
        if (epoch !== generation) return;
        failures++;
        currentMatch = null;
        if (roomId) window.TennisClient.setMatch(null);
        status(`Connection interrupted: ${error.message} Retrying…`);
        if (failures >= 3) {
          reset(); status("Disconnected. Reconnect to play; abandoned matches are forfeited after the server timeout.");
          return;
        }
      }
      await new Promise(resolve => setTimeout(resolve, failures ? 1000 : roomId ? 100 : 1000));
    }
  }

  $("#connect-form").addEventListener("submit", event => {
    event.preventDefault();
    action(async () => {
      const target = { url: serverUrl($("#server-url").value) };
      const session = await request("/api/session", "POST", { name: $("#player-name").value.trim() }, target);
      connection = { ...target, ...session };
      const epoch = ++generation;
      $("#connect").hidden = true; $("#disconnect").hidden = false;
      $("#player-name").disabled = $("#server-url").disabled = true;
      $("#lobby-content").hidden = false;
      $("#connection-badge").textContent = "CONNECTED"; $("#connection-badge").classList.add("connected");
      status("Welcome to the clubhouse. Choose a court or create your own.");
      poll(epoch);
    });
  });
  $("#create-form").addEventListener("submit", event => {
    event.preventDefault();
    action(async () => {
      const room = await request("/api/rooms", "POST", { name: $("#room-name").value.trim(), mode: $("#room-mode").value });
      roomId = room.id; roomMarkup = "";
      renderRoom(await request(`/api/rooms/${encodeURIComponent(roomId)}`));
      status("Room created. Other players can join from this server's lobby.");
    });
  });
  $("#leave-room").addEventListener("click", () => action(async () => {
    await request(`/api/rooms/${encodeURIComponent(roomId)}/leave`, "POST", {});
    roomId = null; currentMatch = null; roomMarkup = "";
    $("#active-room").hidden = true; window.TennisClient.practice();
    status("Left the room. Leaving a live match counts as a forfeit.");
  }));
  $("#disconnect").addEventListener("click", () => action(async () => {
    try {
      if (roomId) await request(`/api/rooms/${encodeURIComponent(roomId)}/leave`, "POST", {});
    } finally { reset(); status("Disconnected. Offline practice is ready."); }
  }));
  document.querySelectorAll("[data-filter]").forEach(button => button.addEventListener("click", () => {
    filter = button.dataset.filter;
    document.querySelectorAll("[data-filter]").forEach(tab => tab.setAttribute("aria-pressed", String(tab === button)));
    renderRooms();
  }));

  setInterval(async () => {
    const input = window.TennisClient.input();
    const edges = window.TennisClient.takeSwingEdges();
    if (inputMatchId !== currentMatch?.id) {
      swingEdges.length = 0;
      inputMatchId = currentMatch?.id;
    }
    if (!currentMatch || currentMatch.state.winner >= 0) swingEdges.length = 0;
    else {
      swingEdges.push(...edges);
      if (swingEdges.length > 16) swingEdges.splice(0, swingEdges.length - 16);
    }
    if (!connection || !roomId || !currentMatch || currentMatch.state.winner >= 0 || inputPending || busy) return;
    const epoch = generation;
    inputPending = true;
    const sendSwing = swingEdges.length ? swingEdges.shift() : input.swing;
    try {
      await request(`/api/rooms/${encodeURIComponent(roomId)}/input`, "POST", { ...input, swing: sendSwing });
    } catch (error) {
      if (epoch === generation) status(`Input delayed: ${error.message}`);
    } finally { inputPending = false; }
  }, 50);
})();
