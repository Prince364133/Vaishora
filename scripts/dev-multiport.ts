import http from "node:http";
import net from "node:net";
import { spawn } from "node:child_process";

const TARGET_HOST = "127.0.0.1";
const CORE_PORT = 3000;

interface ProxyConfig {
  port: number;
  name: string;
  defaultPath: string;
  redirectRoot?: boolean;
}

const SERVICES: ProxyConfig[] = [
  { port: 3003, name: "Main Website", defaultPath: "/" },
  { port: 3001, name: "Artists Portal", defaultPath: "/artist-portal", redirectRoot: true },
  { port: 3002, name: "Admin Portal", defaultPath: "/admin", redirectRoot: true },
];

function createProxyServer(config: ProxyConfig) {
  const server = http.createServer((req, res) => {
    const parsedUrl = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    
    // Redirect root to specific portal if configured
    if (config.redirectRoot && (parsedUrl.pathname === "/" || parsedUrl.pathname === "")) {
      res.writeHead(307, { Location: config.defaultPath });
      res.end();
      return;
    }

    const proxyReq = http.request(
      {
        hostname: TARGET_HOST,
        port: CORE_PORT,
        path: req.url,
        method: req.method,
        headers: {
          ...req.headers,
          host: req.headers.host,
          "x-forwarded-host": req.headers.host,
          "x-forwarded-proto": "http",
          "x-vaishora-service": config.name,
        },
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers);
        proxyRes.pipe(res, { end: true });
      }
    );

    proxyReq.on("error", () => {
      if (!res.headersSent) {
        res.writeHead(502, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;padding:3rem;text-align:center;background:#fcf9f6;color:#3b1e2e;">` +
          `<h2>✦ VAISHORA — Server Starting</h2>` +
          `<p>Connecting to Next.js core application on port ${CORE_PORT}...</p>` +
          `<p style="color:#7a626f;font-size:0.9rem;">Please refresh in a moment.</p>` +
          `</body></html>`
        );
      }
    });

    req.pipe(proxyReq, { end: true });
  });

  // Support WebSockets for Fast Refresh / HMR
  server.on("upgrade", (req, clientSocket, head) => {
    const targetSocket = net.connect(CORE_PORT, TARGET_HOST, () => {
      let rawReq = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const key = req.rawHeaders[i];
        const val = req.rawHeaders[i + 1];
        rawReq += `${key}: ${val}\r\n`;
      }
      rawReq += "\r\n";
      targetSocket.write(rawReq);
      if (head && head.length > 0) {
        targetSocket.write(head);
      }
      targetSocket.pipe(clientSocket);
      clientSocket.pipe(targetSocket);
    });

    targetSocket.on("error", () => {
      clientSocket.destroy();
    });
    clientSocket.on("error", () => {
      targetSocket.destroy();
    });
  });

  return server;
}

console.log("\n==================================================");
console.log("       ✦ VAISHORA MULTI-APP DEV SYSTEM ✦         ");
console.log("==================================================");
console.log(`⚡ Core API & Next.js Engine : http://localhost:${CORE_PORT}`);

const servers: http.Server[] = [];

for (const s of SERVICES) {
  const server = createProxyServer(s);
  server.listen(s.port, () => {
    console.log(`🌐 [${s.port}] ${s.name.padEnd(20)} : http://localhost:${s.port}${s.redirectRoot ? s.defaultPath : ""}`);
  });
  servers.push(server);
}

console.log("==================================================\n");

// Spawn Next.js dev server on port 3000
const nextProcess = spawn("npx", ["next", "dev", "-p", "3000"], {
  stdio: "inherit",
  shell: true,
  env: {
    ...process.env,
    PORT: String(CORE_PORT),
  },
});

function cleanup() {
  for (const s of servers) {
    s.close();
  }
  if (!nextProcess.killed) {
    nextProcess.kill();
  }
  process.exit(0);
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
nextProcess.on("exit", (code) => {
  for (const s of servers) s.close();
  process.exit(code ?? 0);
});
