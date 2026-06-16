import crypto from "node:crypto";
import http from "node:http";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";

const DEFAULT_CLIENT_PATH =
  process.env.READERSBASE_GOOGLE_OAUTH_CLIENT ??
  "C:\\Users\\Maart\\.readersbase\\google-oauth-client.json";
const DEFAULT_TOKEN_PATH =
  process.env.READERSBASE_YOUTUBE_TOKEN ??
  "C:\\Users\\Maart\\.readersbase\\youtube-token.json";

const YOUTUBE_READONLY_SCOPE = "https://www.googleapis.com/auth/youtube.readonly";

function base64Url(buffer) {
  return buffer
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

async function readOAuthClient(path) {
  const raw = await fs.readFile(path, "utf8");
  const parsed = JSON.parse(raw);
  const client = parsed.installed ?? parsed.web;

  if (!client?.client_id) {
    throw new Error(`OAuth client file at ${path} does not contain a client_id.`);
  }

  return {
    clientId: client.client_id,
    clientSecret: client.client_secret,
    authUri: client.auth_uri ?? "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUri: client.token_uri ?? "https://oauth2.googleapis.com/token",
  };
}

function startCallbackServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();

    server.on("request", (req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");

      if (url.pathname !== "/oauth2callback") {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("Not found");
        return;
      }

      const error = url.searchParams.get("error");
      const code = url.searchParams.get("code");

      if (error) {
        res.writeHead(400, { "content-type": "text/plain" });
        res.end(`OAuth failed: ${error}`);
        server.emit("oauth-result", { error });
        return;
      }

      if (!code) {
        res.writeHead(400, { "content-type": "text/plain" });
        res.end("OAuth failed: missing code");
        server.emit("oauth-result", { error: "missing_code" });
        return;
      }

      res.writeHead(200, { "content-type": "text/plain" });
      res.end("YouTube OAuth connected. You can close this browser tab.");
      server.emit("oauth-result", { code });
    });

    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not allocate local callback port."));
        return;
      }
      resolve({ server, port: address.port });
    });
  });
}

function waitForOAuthResult(server) {
  return new Promise((resolve) => {
    server.once("oauth-result", resolve);
  });
}

async function exchangeCode({ client, code, codeVerifier, redirectUri }) {
  const body = new URLSearchParams({
    client_id: client.clientId,
    code,
    code_verifier: codeVerifier,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });

  if (client.clientSecret) {
    body.set("client_secret", client.clientSecret);
  }

  const response = await fetch(client.tokenUri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`Token exchange failed: ${JSON.stringify(payload)}`);
  }

  return payload;
}

async function getYouTubeChannel(accessToken) {
  const params = new URLSearchParams({
    mine: "true",
    part: "id,snippet,statistics",
  });
  const response = await fetch(
    `https://www.googleapis.com/youtube/v3/channels?${params.toString()}`,
    { headers: { authorization: `Bearer ${accessToken}` } },
  );

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`YouTube channel check failed: ${JSON.stringify(payload)}`);
  }

  return payload;
}

async function main() {
  if (!existsSync(DEFAULT_CLIENT_PATH)) {
    throw new Error(`OAuth client JSON not found: ${DEFAULT_CLIENT_PATH}`);
  }

  const client = await readOAuthClient(DEFAULT_CLIENT_PATH);
  const { server, port } = await startCallbackServer();
  const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
  const state = base64Url(crypto.randomBytes(24));
  const codeVerifier = base64Url(crypto.randomBytes(64));
  const codeChallenge = base64Url(
    crypto.createHash("sha256").update(codeVerifier).digest(),
  );

  const authUrl = new URL(client.authUri);
  authUrl.searchParams.set("client_id", client.clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", YOUTUBE_READONLY_SCOPE);
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  console.log("Open this URL in the browser signed in as readersbase@gmail.com:");
  console.log(authUrl.toString());
  console.log("");
  console.log("Waiting for Google OAuth callback...");

  try {
    const result = await waitForOAuthResult(server);
    if (result.error) {
      throw new Error(`OAuth callback returned error: ${result.error}`);
    }

    const token = await exchangeCode({
      client,
      code: result.code,
      codeVerifier,
      redirectUri,
    });
    await fs.writeFile(DEFAULT_TOKEN_PATH, JSON.stringify(token, null, 2));

    const channel = await getYouTubeChannel(token.access_token);
    const first = channel.items?.[0];
    if (!first) {
      throw new Error("OAuth succeeded, but no YouTube channel was returned.");
    }

    console.log("");
    console.log("YouTube OAuth check succeeded.");
    console.log(`Channel ID: ${first.id}`);
    console.log(`Channel title: ${first.snippet?.title ?? "(unknown)"}`);
    console.log(`Subscriber count: ${first.statistics?.subscriberCount ?? "0"}`);
    console.log(`Token saved to: ${DEFAULT_TOKEN_PATH}`);
  } finally {
    server.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
