import crypto from "node:crypto";
import fs from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import http from "node:http";
import path from "node:path";

const DEFAULT_CLIENT_PATH =
  process.env.READERSBASE_GOOGLE_OAUTH_CLIENT ??
  "C:\\Users\\Maart\\.readersbase\\google-oauth-client.json";
const DEFAULT_TOKEN_PATH =
  process.env.READERSBASE_YOUTUBE_UPLOAD_TOKEN ??
  "C:\\Users\\Maart\\.readersbase\\youtube-upload-token.json";

const YOUTUBE_UPLOAD_SCOPE = "https://www.googleapis.com/auth/youtube.upload";
const TOKEN_SAFETY_MARGIN_MS = 60_000;

function usage() {
  console.log(`Usage:
  node scripts/readersbase-youtube-private-upload.mjs --authorize
  node scripts/readersbase-youtube-private-upload.mjs --dry-run <manifest.json>
  node scripts/readersbase-youtube-private-upload.mjs --upload <manifest.json>

Manifest shape:
{
  "videoFile": "C:/absolute/path/video.mp4",
  "title": "Video title",
  "description": "Video description",
  "tags": ["readersbase"],
  "categoryId": "22",
  "privacyStatus": "private"
}

Safety:
  - Uploads require an existing upload token from --authorize.
  - privacyStatus must be "private"; public/unlisted uploads are blocked by this script.
  - The script does not set a thumbnail yet.
`);
}

function base64Url(buffer) {
  return buffer
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2));
}

async function readOAuthClient(filePath) {
  const parsed = await readJson(filePath);
  const client = parsed.installed ?? parsed.web;

  if (!client?.client_id) {
    throw new Error(`OAuth client file at ${filePath} does not contain a client_id.`);
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
      res.end("YouTube upload OAuth connected. You can close this browser tab.");
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

  return {
    ...payload,
    obtained_at: Date.now(),
  };
}

async function refreshAccessToken(client, token) {
  if (!token.refresh_token) {
    throw new Error("Upload token has no refresh_token. Re-run --authorize.");
  }

  const body = new URLSearchParams({
    client_id: client.clientId,
    grant_type: "refresh_token",
    refresh_token: token.refresh_token,
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
    throw new Error(`Token refresh failed: ${JSON.stringify(payload)}`);
  }

  return {
    ...token,
    ...payload,
    refresh_token: token.refresh_token,
    obtained_at: Date.now(),
  };
}

async function getUploadToken() {
  const client = await readOAuthClient(DEFAULT_CLIENT_PATH);
  let token = await readJson(DEFAULT_TOKEN_PATH);
  const expiresAt = token.obtained_at + token.expires_in * 1000;

  if (Date.now() + TOKEN_SAFETY_MARGIN_MS >= expiresAt) {
    token = await refreshAccessToken(client, token);
    await writeJson(DEFAULT_TOKEN_PATH, token);
  }

  return token;
}

async function authorize() {
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
  authUrl.searchParams.set("scope", YOUTUBE_UPLOAD_SCOPE);
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
    await writeJson(DEFAULT_TOKEN_PATH, token);
    console.log(`Upload token saved to: ${DEFAULT_TOKEN_PATH}`);
  } finally {
    server.close();
  }
}

async function readManifest(manifestPath) {
  const manifest = await readJson(manifestPath);
  const resolvedVideoFile = path.resolve(path.dirname(manifestPath), manifest.videoFile);

  if (!manifest.videoFile || !existsSync(resolvedVideoFile)) {
    throw new Error(`Video file not found: ${manifest.videoFile}`);
  }

  if (!manifest.title || typeof manifest.title !== "string") {
    throw new Error("Manifest requires a string title.");
  }

  if (manifest.privacyStatus !== "private") {
    throw new Error('Safety stop: manifest privacyStatus must be exactly "private".');
  }

  const stat = await fs.stat(resolvedVideoFile);
  return {
    ...manifest,
    videoFile: resolvedVideoFile,
    byteSize: stat.size,
    categoryId: manifest.categoryId ?? "22",
    tags: Array.isArray(manifest.tags) ? manifest.tags : [],
    description: manifest.description ?? "",
  };
}

function buildVideoResource(manifest) {
  return {
    snippet: {
      title: manifest.title,
      description: manifest.description,
      tags: manifest.tags,
      categoryId: manifest.categoryId,
    },
    status: {
      privacyStatus: "private",
      selfDeclaredMadeForKids: Boolean(manifest.selfDeclaredMadeForKids),
    },
  };
}

async function dryRun(manifestPath) {
  const manifest = await readManifest(manifestPath);
  const resource = buildVideoResource(manifest);

  console.log("YouTube private upload dry run:");
  console.log(JSON.stringify(
    {
      videoFile: manifest.videoFile,
      byteSize: manifest.byteSize,
      resource,
    },
    null,
    2,
  ));
}

async function upload(manifestPath) {
  const manifest = await readManifest(manifestPath);
  const token = await getUploadToken();
  const resource = buildVideoResource(manifest);
  const params = new URLSearchParams({
    part: "snippet,status",
    notifySubscribers: "false",
    uploadType: "resumable",
  });

  const sessionResponse = await fetch(
    `https://www.googleapis.com/upload/youtube/v3/videos?${params.toString()}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token.access_token}`,
        "content-type": "application/json; charset=UTF-8",
        "x-upload-content-length": String(manifest.byteSize),
        "x-upload-content-type": "video/mp4",
      },
      body: JSON.stringify(resource),
    },
  );

  if (!sessionResponse.ok) {
    throw new Error(
      `Could not create upload session: ${await sessionResponse.text()}`,
    );
  }

  const uploadUrl = sessionResponse.headers.get("location");
  if (!uploadUrl) {
    throw new Error("YouTube did not return a resumable upload URL.");
  }

  const uploadResponse = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "content-length": String(manifest.byteSize),
      "content-type": "video/mp4",
    },
    body: createReadStream(manifest.videoFile),
    duplex: "half",
  });

  const payload = await uploadResponse.json();
  if (!uploadResponse.ok) {
    throw new Error(`Upload failed: ${JSON.stringify(payload)}`);
  }

  console.log("Private YouTube upload succeeded.");
  console.log(`Video ID: ${payload.id}`);
  console.log(`URL: https://www.youtube.com/watch?v=${payload.id}`);
}

async function main() {
  const [command, manifestPath] = process.argv.slice(2);

  if (!command || command === "--help" || command === "-h") {
    usage();
    return;
  }

  if (command === "--authorize") {
    await authorize();
    return;
  }

  if (!manifestPath) {
    throw new Error(`${command} requires a manifest path.`);
  }

  if (command === "--dry-run") {
    await dryRun(path.resolve(manifestPath));
    return;
  }

  if (command === "--upload") {
    await upload(path.resolve(manifestPath));
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
