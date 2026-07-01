// TMail Demo Server
// Dijalankan hanya dengan Node.js bawaan (tanpa npm install) supaya mudah dicoba di mana saja.
// Untuk PRODUCTION sungguhan: sambungkan endpoint /api/webhook ini ke layanan penerima email
// asli (Cloudflare Email Routing, Mailgun Inbound Route, dst) yang mem-forward email dari
// domain yang benar-benar kamu miliki.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const url = require('url');

const PORT = process.env.PORT || 8787;
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---- "Domain" yang tersedia (simulasi) ----
// Di production, ini harus domain asli yang MX record-nya kamu arahkan ke mail receiver.
const DOMAINS = ['mailtrap.monster', 'inbox-demo.test', 'quickpeek.mail'];

// ---- Penyimpanan sementara di memori ----
// key: alamat email (lowercase) -> { createdAt, messages: [...] }
const store = new Map();
const TTL_MS = 60 * 60 * 1000; // 1 jam, meniru sifat "sementara" dari temp mail

function ensureMailbox(address) {
  const key = address.toLowerCase();
  if (!store.has(key)) {
    store.set(key, { createdAt: Date.now(), messages: [] });
  }
  return store.get(key);
}

// Bersihkan mailbox yang sudah kadaluarsa setiap 5 menit
setInterval(() => {
  const now = Date.now();
  for (const [key, box] of store.entries()) {
    if (now - box.createdAt > TTL_MS) store.delete(key);
  }
}, 5 * 60 * 1000);

function randomWord(len = 8) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < len; i++) out += chars[crypto.randomInt(chars.length)];
  return out;
}

function randomEmail() {
  const domain = DOMAINS[crypto.randomInt(DOMAINS.length)];
  return `${randomWord(9)}@${domain}`;
}

function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

function serveStatic(req, res, pathname) {
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.join(PUBLIC_DIR, filePath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    const ext = path.extname(filePath);
    const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  const { pathname, query } = parsed;

  // ---- API: generate alamat email acak ----
  if (pathname === '/api/generate/email' && req.method === 'GET') {
    const address = randomEmail();
    ensureMailbox(address);
    return sendJSON(res, 200, { address, domains: DOMAINS });
  }

  // ---- API: generate hanya username (domain tetap) ----
  if (pathname === '/api/generate/user' && req.method === 'GET') {
    const domain = query.domain && DOMAINS.includes(query.domain) ? query.domain : DOMAINS[0];
    const address = `${randomWord(9)}@${domain}`;
    ensureMailbox(address);
    return sendJSON(res, 200, { address, domains: DOMAINS });
  }

  // ---- API: daftar domain ----
  if (pathname === '/api/domains' && req.method === 'GET') {
    return sendJSON(res, 200, { domains: DOMAINS });
  }

  // ---- API: lihat isi inbox suatu alamat ----
  if (pathname.startsWith('/api/inbox/') && req.method === 'GET') {
    const address = decodeURIComponent(pathname.replace('/api/inbox/', ''));
    const box = ensureMailbox(address);
    return sendJSON(res, 200, {
      address,
      createdAt: box.createdAt,
      messages: box.messages,
    });
  }

  // ---- API: webhook penerima email (di production dipanggil oleh mail service asli) ----
  if (pathname === '/api/webhook' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const { to, from, subject, text } = payload;
        if (!to) return sendJSON(res, 400, { error: 'Field "to" wajib diisi' });
        const box = ensureMailbox(to);
        const message = {
          id: crypto.randomUUID(),
          from: from || 'unknown@sender.com',
          subject: subject || '(tanpa subjek)',
          text: text || '',
          receivedAt: Date.now(),
        };
        box.messages.unshift(message);
        return sendJSON(res, 201, { ok: true, message });
      } catch (e) {
        return sendJSON(res, 400, { error: 'JSON tidak valid' });
      }
    });
    return;
  }

  // ---- API: simulasi cepat (dev only) — kirim email uji tanpa perlu domain asli ----
  if (pathname === '/api/simulate' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        const { to } = JSON.parse(body || '{}');
        if (!to) return sendJSON(res, 400, { error: 'Field "to" wajib diisi' });
        const box = ensureMailbox(to);
        const samples = [
          { from: 'noreply@github.com', subject: 'Konfirmasi verifikasi akun', text: 'Klik link berikut untuk verifikasi akun GitHub kamu.' },
          { from: 'promo@toko-online.id', subject: 'Diskon 50% khusus hari ini!', text: 'Jangan sampai kelewatan, promo cuma sampai jam 23.59.' },
          { from: 'security@service.com', subject: 'Kode OTP kamu', text: 'Kode OTP: ' + crypto.randomInt(100000, 999999) },
        ];
        const s = samples[crypto.randomInt(samples.length)];
        const message = { id: crypto.randomUUID(), ...s, receivedAt: Date.now() };
        box.messages.unshift(message);
        return sendJSON(res, 201, { ok: true, message });
      } catch (e) {
        return sendJSON(res, 400, { error: 'JSON tidak valid' });
      }
    });
    return;
  }

  // ---- Static frontend ----
  if (req.method === 'GET') {
    return serveStatic(req, res, pathname);
  }

  res.writeHead(405);
  res.end('Method not allowed');
});

server.listen(PORT, () => {
  console.log(`TMail demo server jalan di http://localhost:${PORT}`);
});
