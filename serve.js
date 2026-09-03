// Minimal static file server — zero dependencies (Node built-ins only).
//
// Echo Runner has no external assets/CDN calls, so opening index.html
// directly (file://) works fine for solo dev/testing. This server exists for
// later: testing on an actual phone over the local network, and as the base
// for the eventual Capacitor wrap. Avoids adding a build tool for something
// this simple.
//
// Usage: node serve.js   (then open http://localhost:8080)

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 8080;
const ROOT = __dirname;

const MIME_TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";

  const filePath = path.join(ROOT, urlPath);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found: " + urlPath);
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      // No caching during dev — we're iterating fast on main.js/index.html
      // and a stale cached copy after an edit is a confusing false signal.
      "Cache-Control": "no-store",
    });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Serving G:/cricket-game at http://localhost:${PORT}`);
});
