import { randomBytes, scryptSync } from "node:crypto";

function hiddenPrompt(label) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(new Error("Run this command in an interactive terminal."));
      return;
    }

    let value = "";
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    process.stdout.write(label);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    function finish(error) {
      stdin.off("data", onData);
      stdin.setRawMode(Boolean(wasRaw));
      stdin.pause();
      process.stdout.write("\n");
      if (error) reject(error);
      else resolve(value);
    }

    function onData(character) {
      if (character === "\u0003") return finish(new Error("Cancelled"));
      if (character === "\r" || character === "\n") return finish();
      if (character === "\u007f") {
        value = value.slice(0, -1);
        return;
      }
      value += character;
    }

    stdin.on("data", onData);
  });
}

const password = await hiddenPrompt("Choose your HomeScope password: ");
if (password.length < 12) throw new Error("Use at least 12 characters.");
const confirmation = await hiddenPrompt("Confirm your HomeScope password: ");
if (password !== confirmation) throw new Error("The passwords do not match.");

const salt = randomBytes(24).toString("base64url");
const hash = scryptSync(password, salt, 64).toString("hex");

console.log("\nAdd this value to Vercel as HOMESCOPE_PASSWORD_SCRYPT:\n");
console.log(`scrypt$${salt}$${hash}`);
