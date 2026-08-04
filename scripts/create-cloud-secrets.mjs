import { execFileSync } from "node:child_process";
import { randomBytes, scryptSync } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

function runDialog(message, options = {}) {
  const escapedMessage = message.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  const escapedDefault = String(options.defaultAnswer || "").replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  const hidden = options.hidden ? " with hidden answer" : "";
  const script = `text returned of (display dialog "${escapedMessage}" default answer "${escapedDefault}"${hidden} buttons {"Cancel", "Continue"} default button "Continue" with title "HomeScope Cloud Setup")`;
  return execFileSync("osascript", [
    "-e", 'tell application "Finder"',
    "-e", "activate",
    "-e", script,
    "-e", "end tell",
  ], { encoding: "utf8" }).trim();
}

const email = runDialog("Enter the only email address allowed to sign in to HomeScope:")
  .trim()
  .toLowerCase();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address.");

const password = runDialog("Choose a unique HomeScope password (at least 12 characters):", { hidden: true });
if (password.length < 12) throw new Error("Use at least 12 characters.");
const confirmation = runDialog("Enter the same HomeScope password again:", { hidden: true });
if (password !== confirmation) throw new Error("The passwords do not match.");

const salt = randomBytes(24).toString("base64url");
const passwordHash = `scrypt$${salt}$${scryptSync(password, salt, 64).toString("hex")}`;
const secrets = {
  HOMESCOPE_AUTH_REQUIRED: "true",
  HOMESCOPE_LOGIN_EMAIL: email,
  HOMESCOPE_PASSWORD_SCRYPT: passwordHash,
  HOMESCOPE_SESSION_SECRET: randomBytes(48).toString("base64url"),
  HOMESCOPE_COLLECTOR_TOKEN: randomBytes(48).toString("base64url"),
};

const output = resolve(".homescope-cloud-secrets.json");
writeFileSync(output, `${JSON.stringify(secrets, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
console.log("HomeScope cloud credentials were created securely.");
console.log("The plaintext password was not saved.");
