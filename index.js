console.log("1. Iniciando...");

const fs = require("fs");
const os = require("os");
const https = require("https");
const { WebSocketServer } = require("ws");


console.log("2. Módulos carregados");

const key = fs.readFileSync("key.pem");
const cert = fs.readFileSync("cert.pem");
console.log("3. Certificados lidos");

// Cada celular (pid) ganha um número de jogador: 1, 2, 3...
// O número fica guardado para sempre, assim o celular volta a ser o mesmo jogador
// se parar de enviar por um momento.
const players = new Map();   // pid -> { id, lastSeen, active }
let nextId = 1;
const TIMEOUT_MS = 2000;     // sem receber nada por 2 s = jogador saiu

const httpsServer = https.createServer({ key, cert }, (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  // Página do controle
  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(fs.readFileSync("index.html"));
  }

  // Recebe os dados do celular
  if (req.method === "POST" && req.url === "/input") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const data = JSON.parse(body);
        const pid = String(data.pid || "1");

        let p = players.get(pid);
        if (!p) {
          p = { id: nextId++, lastSeen: 0, active: false };
          players.set(pid, p);
        }
        if (!p.active) {
          p.active = true;
          console.log("Jogador " + p.id + " entrou");
          toGame({ type: "join", id: p.id });
        }
        p.lastSeen = Date.now();

        // Manda pro Godot (id é um número, e steer fica entre -1 e 1)
        toGame({
          type: "input",
          id: p.id,
          steer: Math.max(-1, Math.min(1, Number(data.steer) || 0)),
          gas: !!data.gas,
          brake: !!data.brake,
        });

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400);
        res.end("erro");
      }
    });
    return;
  }

  res.writeHead(404);
  res.end("não encontrado");
});

console.log("4. Servidor HTTPS criado");

httpsServer.listen(8443, "0.0.0.0", () => {
  console.log("5. HTTPS escutando na porta 8443");
});

httpsServer.on("error", (err) => console.error("ERRO HTTPS:", err.message));

// ===== Servidor WebSocket pro Godot =====
const gameServer = new WebSocketServer({ port: 8080, host: "127.0.0.1" });
let game = null;

gameServer.on("connection", (ws) => {
  game = ws;
  console.log("Godot conectado");
  // Se o Godot abriu depois dos celulares, avisa quem já está jogando
  for (const p of players.values()) {
    if (p.active) ws.send(JSON.stringify({ type: "join", id: p.id }));
  }
  ws.on("close", () => {
    if (game === ws) game = null;
    console.log("Godot desconectado");
  });
});
gameServer.on("error", (err) => console.error("ERRO WebSocket:", err.message));

function toGame(obj) {
  if (game && game.readyState === 1) {
    game.send(JSON.stringify(obj));
  }
}

// Avisa o Godot quando um celular para de enviar
setInterval(() => {
  const now = Date.now();
  for (const p of players.values()) {
    if (p.active && now - p.lastSeen > TIMEOUT_MS) {
      p.active = false;
      console.log("Jogador " + p.id + " saiu");
      toGame({ type: "leave", id: p.id });
    }
  }
}, 500);

console.log("6. Tudo configurado!");
for (const list of Object.values(os.networkInterfaces())) {
  for (const n of list) {
    if (n.family === "IPv4" && !n.internal) console.log("Celular → https://" + n.address + ":8443");
  }
}
console.log("Godot  → ws://127.0.0.1:8080");