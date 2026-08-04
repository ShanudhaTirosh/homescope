import http from "node:http";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const host = "127.0.0.1";
const port = Number(process.env.HOMESCOPE_SETUP_PORT || 47831);
const csrf = randomBytes(24).toString("base64url");
const output = resolve(".homescope-cloud-secrets.json");

function page(message = "", success = false) {
  const notice = message
    ? `<div class="notice ${success ? "success" : "error"}">${escapeHtml(message)}</div>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>HomeScope secure setup</title>
  <style>
    *{box-sizing:border-box}body{margin:0;min-height:100vh;padding:24px;display:grid;place-items:center;color:#e9f8f1;background:radial-gradient(circle at 15% 10%,#173e30,transparent 31%),#07100c;font:15px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    main{width:min(480px,100%);padding:32px;border:1px solid #294a3d;border-radius:22px;background:#102019;box-shadow:0 30px 90px #0008}
    .brand{display:flex;align-items:center;gap:12px}.mark{width:44px;height:44px;border-radius:14px;display:grid;place-items:center;color:#07100c;background:#69dfb7;font-weight:900}.brand strong,.brand span{display:block}.brand span{margin-top:3px;color:#8da99e;font-size:12px}
    h1{margin:38px 0 8px;font-size:29px;letter-spacing:-.04em}p{margin:0;color:#91aa9f;line-height:1.5}
    form{margin-top:27px;display:grid;gap:16px}label span{display:block;margin-bottom:7px;color:#bfd0c9;font-size:12px;font-weight:700}input{width:100%;height:50px;padding:0 14px;border:1px solid #345247;border-radius:11px;outline:0;color:#f5fff9;background:#0a1812;font:inherit}input:focus{border-color:#69dfb7;box-shadow:0 0 0 3px #69dfb722}
    button{height:50px;margin-top:4px;border:0;border-radius:11px;color:#062018;background:#69dfb7;font:inherit;font-weight:800;cursor:pointer}.fine{margin-top:21px;padding-top:19px;border-top:1px solid #294239;color:#789187;font-size:11px;text-align:center}.notice{margin-top:23px;padding:14px;border-radius:11px}.error{color:#ffb0b4;background:#391b20}.success{color:#9ff0d0;background:#12382b}
  </style>
</head>
<body>
  <main>
    <div class="brand"><div class="mark">H</div><div><strong>HomeScope</strong><span>Secure cloud setup</span></div></div>
    <h1>${success ? "Credentials ready" : "Create your private login"}</h1>
    <p>${success ? "Your password was hashed locally and its plaintext was not saved. You can return to Codex." : "This page is available only on this Mac. Your password never leaves the local setup process."}</p>
    ${notice}
    ${success ? "" : `<form method="post" action="/save" autocomplete="off">
      <input type="hidden" name="csrf" value="${csrf}">
      <label><span>Authorized email</span><input type="email" name="email" autocomplete="username" required autofocus></label>
      <label><span>Choose password</span><input type="password" name="password" minlength="12" autocomplete="new-password" required></label>
      <label><span>Confirm password</span><input type="password" name="confirmation" minlength="12" autocomplete="new-password" required></label>
      <button type="submit">Save secure login</button>
    </form>`}
    <div class="fine">Bound to 127.0.0.1 · Not accessible from another device</div>
  </main>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

async function readForm(request) {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 32_768) throw new Error("Request is too large.");
  }
  return new URLSearchParams(raw);
}

const server = http.createServer(async (request, response) => {
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("X-Content-Type-Options", "nosniff");

  if (request.method === "GET" && request.url === "/") {
    response.end(page());
    return;
  }
  if (request.method !== "POST" || request.url !== "/save") {
    response.statusCode = 404;
    response.end(page("Not found."));
    return;
  }

  try {
    const form = await readForm(request);
    const suppliedCsrf = Buffer.from(form.get("csrf") || "");
    const expectedCsrf = Buffer.from(csrf);
    if (suppliedCsrf.length !== expectedCsrf.length || !timingSafeEqual(suppliedCsrf, expectedCsrf)) {
      throw new Error("The setup form expired. Reload it and try again.");
    }
    const email = (form.get("email") || "").trim().toLowerCase();
    const password = form.get("password") || "";
    const confirmation = form.get("confirmation") || "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address.");
    if (password.length < 12) throw new Error("Use at least 12 characters.");
    if (password !== confirmation) throw new Error("The passwords do not match.");

    const salt = randomBytes(24).toString("base64url");
    const secrets = {
      HOMESCOPE_AUTH_REQUIRED: "true",
      HOMESCOPE_LOGIN_EMAIL: email,
      HOMESCOPE_PASSWORD_SCRYPT: `scrypt$${salt}$${scryptSync(password, salt, 64).toString("hex")}`,
      HOMESCOPE_SESSION_SECRET: randomBytes(48).toString("base64url"),
      HOMESCOPE_COLLECTOR_TOKEN: randomBytes(48).toString("base64url"),
    };
    writeFileSync(output, `${JSON.stringify(secrets, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    response.end(page("HomeScope cloud credentials were created successfully.", true));
    console.log("HomeScope cloud credentials were created securely.");
  } catch (error) {
    response.statusCode = 400;
    response.end(page(error instanceof Error ? error.message : "Could not save the login."));
  }
});

server.listen(port, host, () => {
  console.log(`HomeScope secure setup is ready at http://${host}:${port}`);
});
