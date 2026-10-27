
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { WebSocketServer, WebSocket } = require("ws");

const PORT = 3001;
const PORT_GAME = 8080;
const TIMEOUT_MS = 2000;

const htmlPath = path.join(__dirname, "index.html");

if (!fs.existsSync(htmlPath)) {
  console.error("ERRO: index.html não encontrado!");
  process.exit(1);
}

const players = new Map();
let nextId = 1;
let game = null;

function toGame(data) {
  if (game && game.readyState === WebSocket.OPEN) {
    game.send(JSON.stringify(data));
  }
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
  });

  res.end(JSON.stringify(data));
}

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;

  console.log(
    `${req.method} ${pathname} - ${req.socket.remoteAddress}`
  );

  // Página principal
  if (req.method === "GET" && pathname === "/") {
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
    });

    return fs.createReadStream(htmlPath).pipe(res);
  }

  // Status da API
  if (req.method === "GET" && pathname === "/") {
    return sendJson(res, 200, {
      ok: true,
      server: "online",
      godot: !!game && game.readyState === WebSocket.OPEN,
      activePlayers: [...players.values()].filter(p => p.active).length,
    });
  }

  // Recebe os controles dos celulares
  if (req.method === "POST" && pathname === "/input") {
    let body = "";
    let size = 0;

    req.on("data", chunk => {
      size += chunk.length;

      if (size > 16384) {
        res.writeHead(413);
        res.end("Dados muito grandes");
        req.destroy();
        return;
      }

      body += chunk.toString("utf8");
    });

    req.on("end", () => {
      if (res.writableEnded) return;

      let data;

      try {
        data = JSON.parse(body);
      } catch {
        return sendJson(res, 400, {
          ok: false,
          error: "JSON inválido",
        });
      }

      if (data.pid == null || String(data.pid).trim() === "") {
        return sendJson(res, 400, {
          ok: false,
          error: "PID não informado",
        });
      }

      const pid = String(data.pid).trim();

      let player = players.get(pid);

      if (!player) {
        player = {
          id: nextId++,
          lastSeen: 0,
          active: false,
        };

        players.set(pid, player);
      }

      player.lastSeen = Date.now();

      if (!player.active) {
        player.active = true;
        console.log(`Jogador ${player.id} entrou`);

        toGame({
          type: "join",
          id: player.id,
        });
      }

      let steer = Number(data.steer);

      if (!Number.isFinite(steer)) steer = 0;

      steer = Math.max(-1, Math.min(1, steer));

      toGame({
        type: "input",
        id: player.id,
        steer,
        gas: data.gas === true,
        brake: data.brake === true,
      });

      return sendJson(res, 200, {
        ok: true,
        id: player.id,
      });
    });

    req.on("error", err => {
      console.error("Erro ao receber dados:", err.message);
    });

    return;
  }

  return sendJson(res, 404, {
    ok: false,
    error: "Rota não encontrada",
  });
});

// WebSocket do Godot: permanece acessível apenas localmente
const gameServer = new WebSocketServer({
  host: "127.0.0.1",
  port: PORT_GAME,
});

gameServer.on("connection", ws => {
  game = ws;
  console.log("Godot conectado");

  for (const player of players.values()) {
    if (player.active) {
      ws.send(JSON.stringify({
        type: "join",
        id: player.id,
      }));
    }
  }

  ws.on("close", () => {
    if (game === ws) game = null;
    console.log("Godot desconectado");
  });

  ws.on("error", err => {
    console.error("Erro WebSocket:", err.message);
  });
});

gameServer.on("error", err => {
  console.error("Erro no servidor WebSocket:", err.message);
});

// Detecta celulares que pararam de enviar controles
setInterval(() => {
  const now = Date.now();

  for (const player of players.values()) {
    if (player.active && now - player.lastSeen > TIMEOUT_MS) {
      player.active = false;

      console.log(`Jogador ${player.id} saiu`);

      toGame({
        type: "leave",
        id: player.id,
      });
    }
  }
}, 500);

// Escuta conexões de outros dispositivos
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Servidor ativo na porta ${PORT}`);

  for (const list of Object.values(os.networkInterfaces())) {
    for (const n of list || []) {
      if (n.family === "IPv4" && !n.internal) {
        console.log(`Página: http://${n.address}:${PORT}/`);
      }
    }
  }

  console.log(`Godot: ws://127.0.0.1:${PORT_GAME}`);
});

server.on("error", err => {
  console.error("Erro HTTP:", err.message);
});
