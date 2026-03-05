const crypto = require("crypto");
const path = require("path");
const fs = require("fs/promises");
const express = require("express");
const dotenv = require("dotenv");
const multer = require("multer");
const { imageSize } = require("image-size");
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

dotenv.config({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });
dotenv.config({ quiet: true });

function readOptionalEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) {
    return "";
  }

  const upper = value.toUpperCase();
  if (
    upper === "REPLACE_ME" ||
    upper.startsWith("REPLACE_WITH_") ||
    upper === "CHANGE_ME" ||
    upper === "CHANGEME" ||
    upper === "YOUR_VALUE_HERE"
  ) {
    return "";
  }

  return value;
}

const app = express();
const port = Number(process.env.PORT || 3000);

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
const PLAYER_BASE_URL = process.env.PLAYER_BASE_URL || "https://player.dialog-trainer.local";
const AWS_REGION = process.env.AWS_REGION || "us-east-1";
const S3_BUCKET = readOptionalEnv("S3_BUCKET");
const AWS_ACCESS_KEY_ID = readOptionalEnv("AWS_ACCESS_KEY_ID");
const AWS_SECRET_ACCESS_KEY = readOptionalEnv("AWS_SECRET_ACCESS_KEY");
const ASSET_CHARACTER_MAX_BYTES = Number(process.env.ASSET_CHARACTER_MAX_BYTES || 2 * 1024 * 1024);
const ASSET_BACKGROUND_MAX_BYTES = Number(process.env.ASSET_BACKGROUND_MAX_BYTES || 1 * 1024 * 1024);
const ASSET_SIGNED_URL_TTL_SEC = Number(process.env.ASSET_SIGNED_URL_TTL_SEC || 3600);
const LOCAL_ASSET_PREFIX = String(process.env.LOCAL_ASSET_PREFIX || "uploads/library-assets")
  .trim()
  .replace(/\\/g, "/")
  .replace(/^\/+|\/+$/g, "") || "uploads/library-assets";
const TEMP_PREVIEW_TTL_SEC = Number(process.env.TEMP_PREVIEW_TTL_SEC || 1800);

const ASSET_ALLOWED_MIME = {
  character: new Set(["image/png", "image/svg+xml"]),
  background: new Set(["image/jpeg", "image/png", "image/webp"]),
};

const CHARACTER_EMOTION_STATES = new Set(["neutral", "happy", "concerned", "angry"]);
const CHARACTER_EMOTION_ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
]);

const ASSET_MIME_TO_EXT = {
  "image/png": "png",
  "image/svg+xml": "svg",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

const s3Client =
  S3_BUCKET && AWS_ACCESS_KEY_ID && AWS_SECRET_ACCESS_KEY
    ? new S3Client({
        region: AWS_REGION,
        credentials: {
          accessKeyId: AWS_ACCESS_KEY_ID,
          secretAccessKey: AWS_SECRET_ACCESS_KEY,
        },
      })
    : null;

const assetUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 1,
    fileSize: Math.max(ASSET_CHARACTER_MAX_BYTES, ASSET_BACKGROUND_MAX_BYTES),
  },
});

const tempPreviewSessions = new Map();

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));

const publicDir = path.resolve(process.cwd(), "public");
app.use(express.static(publicDir));

const ASSET_STORAGE_DRIVER = s3Client && S3_BUCKET ? "s3" : "local";

function ensureJsonObject(payload) {
  return Boolean(payload && typeof payload === "object");
}

function ensurePlainObject(payload) {
  return Boolean(payload && typeof payload === "object" && !Array.isArray(payload));
}

function sanitizeAssetType(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "character" || normalized === "background" ? normalized : null;
}

function sanitizeAssetTitle(value) {
  const title = String(value || "").trim().slice(0, 160);
  return title || null;
}

function sanitizeCharacterEmotionState(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return CHARACTER_EMOTION_STATES.has(normalized) ? normalized : null;
}

function sanitizeWorkspaceId(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return null;
  }

  return /^[0-9a-fA-F-]{36}$/.test(normalized) ? normalized : null;
}

function getAssetSizeLimit(assetType) {
  return assetType === "character" ? ASSET_CHARACTER_MAX_BYTES : ASSET_BACKGROUND_MAX_BYTES;
}

function assertS3Configured() {
  if (!s3Client || !S3_BUCKET) {
    const error = new Error("S3 is not configured. Missing bucket or credentials.");
    error.status = 500;
    throw error;
  }
}

function normalizeAssetObjectKey(value) {
  return String(value || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
}

function isLocalAssetUrl(value) {
  return String(value || "").startsWith("/");
}

function buildLocalAssetUrl(key) {
  const normalized = normalizeAssetObjectKey(key);
  return normalized ? `/${normalized}` : null;
}

function resolveLocalAssetAbsolutePath(key) {
  const normalized = normalizeAssetObjectKey(key);
  const absolutePath = path.resolve(publicDir, normalized);
  const allowedRoot = path.resolve(publicDir, LOCAL_ASSET_PREFIX);

  if (
    absolutePath !== allowedRoot &&
    !absolutePath.startsWith(`${allowedRoot}${path.sep}`)
  ) {
    const error = new Error("Invalid local asset path.");
    error.status = 400;
    throw error;
  }

  return absolutePath;
}

async function putAssetObject(objectKey, buffer, mimeType) {
  if (ASSET_STORAGE_DRIVER === "s3") {
    assertS3Configured();
    await s3Client.send(
      new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: objectKey,
        Body: buffer,
        ContentType: mimeType,
      })
    );
    return buildS3ObjectHttpUrl(objectKey);
  }

  const absolutePath = resolveLocalAssetAbsolutePath(objectKey);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, buffer);
  return buildLocalAssetUrl(objectKey);
}

async function deleteAssetObject(objectKey, fileUrl) {
  if (!objectKey) {
    return;
  }

  if (!isLocalAssetUrl(fileUrl)) {
    if (s3Client && S3_BUCKET) {
      await s3Client
        .send(
          new DeleteObjectCommand({
            Bucket: S3_BUCKET,
            Key: objectKey,
          })
        )
        .catch(() => null);
    }
    return;
  }

  const absolutePath = resolveLocalAssetAbsolutePath(objectKey);
  await fs.unlink(absolutePath).catch(() => null);
}

function buildS3ObjectHttpUrl(key) {
  const encodedKey = String(key || "")
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `https://${S3_BUCKET}.s3.${AWS_REGION}.amazonaws.com/${encodedKey}`;
}

function getUploadExtFromMime(mimeType) {
  const normalized = String(mimeType || "").trim().toLowerCase();
  return ASSET_MIME_TO_EXT[normalized] || "bin";
}

function parseImageDimensions(buffer) {
  try {
    const dimensions = imageSize(buffer);
    return {
      width: Number.isFinite(dimensions?.width) ? dimensions.width : null,
      height: Number.isFinite(dimensions?.height) ? dimensions.height : null,
    };
  } catch (_error) {
    return { width: null, height: null };
  }
}

function resolveObjectKeyFromAssetUrl(value) {
  const url = String(value || "").trim();
  if (!isLocalAssetUrl(url)) {
    return null;
  }

  return normalizeAssetObjectKey(url.replace(/^\/+/, ""));
}

function countEmotionImagesFromMetadata(metadataInput) {
  if (!ensurePlainObject(metadataInput)) {
    return 0;
  }

  const images = ensurePlainObject(metadataInput.emotionImages) ? metadataInput.emotionImages : {};
  return Array.from(CHARACTER_EMOTION_STATES).reduce((count, state) => {
    const value = String(images[state] || "").trim();
    return value ? count + 1 : count;
  }, 0);
}

function collectEmotionAssetRefs(metadataInput) {
  if (!ensurePlainObject(metadataInput)) {
    return [];
  }

  const imageUrls = ensurePlainObject(metadataInput.emotionImages) ? metadataInput.emotionImages : {};
  const imageKeys = ensurePlainObject(metadataInput.emotionImageKeys) ? metadataInput.emotionImageKeys : {};
  const refsByKey = new Map();

  Array.from(CHARACTER_EMOTION_STATES).forEach((state) => {
    const stateUrl = String(imageUrls[state] || "").trim();
    const explicitKey = normalizeAssetObjectKey(imageKeys[state] || "");
    const derivedKey = resolveObjectKeyFromAssetUrl(stateUrl);
    const key = explicitKey || derivedKey;

    if (!key) {
      return;
    }

    refsByKey.set(key, {
      key,
      url: stateUrl || buildLocalAssetUrl(key) || "",
    });
  });

  return Array.from(refsByKey.values());
}

async function resolveSignedAssetUrl(assetRow) {
  if (isLocalAssetUrl(assetRow?.file_url)) {
    return assetRow.file_url || null;
  }

  if (!assetRow?.s3_key || !s3Client || !S3_BUCKET) {
    return assetRow?.file_url || null;
  }

  try {
    return await getSignedUrl(
      s3Client,
      new GetObjectCommand({
        Bucket: S3_BUCKET,
        Key: assetRow.s3_key,
      }),
      { expiresIn: ASSET_SIGNED_URL_TTL_SEC }
    );
  } catch (_error) {
    return assetRow.file_url || null;
  }
}

async function mapLibraryAsset(assetRow) {
  const signedUrl = await resolveSignedAssetUrl(assetRow);
  const thumbnailUrl =
    assetRow.source === "user_upload"
      ? signedUrl
      : assetRow.thumbnail_url || assetRow.file_url || null;

  return {
    id: assetRow.id,
    type: assetRow.type,
    title: assetRow.title,
    source: assetRow.source,
    fileUrl: signedUrl,
    thumbnailUrl,
    mimeType: assetRow.mime_type,
    fileSizeBytes: Number(assetRow.file_size_bytes || 0),
    createdAt: assetRow.created_at,
    updatedAt: assetRow.updated_at,
    ownerId: assetRow.owner_id || null,
    isActive: Boolean(assetRow.is_active),
    width: assetRow.width || null,
    height: assetRow.height || null,
    workspaceId: assetRow.workspace_id || null,
    canDelete: assetRow.source === "user_upload",
    metadata: ensureJsonObject(assetRow.metadata_json) ? assetRow.metadata_json : {},
  };
}

function getAuthToken(req) {
  const header = String(req.headers.authorization || "");
  if (!header.toLowerCase().startsWith("bearer ")) {
    return null;
  }

  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}

function formatErrorPayload(error, fallbackMessage) {
  return {
    error:
      error?.data?.msg ||
      error?.data?.error_description ||
      error?.data?.error ||
      error?.data?.message ||
      error?.message ||
      fallbackMessage,
    details: error?.data?.details || null,
  };
}

async function fetchJsonSafe(response) {
  return response.json().catch(() => ({}));
}

async function getCurrentUser(token) {
  const response = await fetch(`${SUPABASE_URL.replace(/\/+$/, "")}/auth/v1/user`, {
    method: "GET",
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${token}`,
    },
  });

  const data = await fetchJsonSafe(response);

  if (!response.ok) {
    const error = new Error("Unauthorized.");
    error.status = 401;
    error.data = data;
    throw error;
  }

  return data;
}

async function requireUserContext(req, res) {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    res.status(500).json({
      error: "Backend is not configured. Missing SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY.",
    });
    return null;
  }

  const token = getAuthToken(req);
  if (!token) {
    res.status(401).json({ error: "Unauthorized. Missing Bearer token." });
    return null;
  }

  try {
    const user = await getCurrentUser(token);
    return { token, user };
  } catch (error) {
    const payload = formatErrorPayload(error, "Unauthorized.");
    res.status(error.status || 401).json(payload);
    return null;
  }
}

async function supabaseRest(pathname, options) {
  const method = options?.method || "GET";
  const token = options?.token;
  const body = options?.body;
  const prefer = options?.prefer;

  const headers = {
    apikey: SUPABASE_PUBLISHABLE_KEY,
    Authorization: `Bearer ${token}`,
  };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  if (prefer) {
    headers.Prefer = prefer;
  }

  const response = await fetch(`${SUPABASE_URL.replace(/\/+$/, "")}/rest/v1${pathname}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const data = await fetchJsonSafe(response);

  if (!response.ok) {
    const error = new Error(data?.message || "Supabase REST request failed.");
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

async function getWorkspaceMemberships(token, userId) {
  return supabaseRest(
    `/workspace_members?select=workspace_id,role&user_id=eq.${encodeURIComponent(userId)}`,
    { token }
  );
}

async function getSimulatorById(token, simulatorId) {
  const rows = await supabaseRest(
    `/simulators?select=id,workspace_id,name,description,status,created_at,updated_at,created_by&id=eq.${encodeURIComponent(simulatorId)}&limit=1`,
    { token }
  );

  return rows[0] || null;
}

async function getMembershipForWorkspace(token, userId, workspaceId) {
  const rows = await supabaseRest(
    `/workspace_members?select=workspace_id,role&user_id=eq.${encodeURIComponent(userId)}&workspace_id=eq.${encodeURIComponent(workspaceId)}&limit=1`,
    { token }
  );

  return rows[0] || null;
}

async function ensureWorkspaceForUser(token, user) {
  const memberships = await getWorkspaceMemberships(token, user.id);
  const editableMemberships = memberships.filter(
    (row) => row.role === "owner" || row.role === "editor"
  );

  if (editableMemberships.length > 0) {
    return editableMemberships[0].workspace_id;
  }

  const userName =
    String(user?.user_metadata?.full_name || "").trim() ||
    String(user?.email || "").split("@")[0] ||
    "New";

  const workspaceName = `${userName} Workspace`;
  const workspaceId = crypto.randomUUID();

  await supabaseRest("/workspaces", {
    method: "POST",
    token,
    prefer: "return=minimal",
    body: {
      id: workspaceId,
      name: workspaceName,
      owner_user_id: user.id,
    },
  });

  return workspaceId;
}

async function resolveWorkspaceForAssetRead(token, user, requestedWorkspaceId) {
  const memberships = await getWorkspaceMemberships(token, user.id);
  const requested = sanitizeWorkspaceId(requestedWorkspaceId);

  if (requested) {
    const membership = memberships.find((row) => row.workspace_id === requested);
    if (!membership) {
      const error = new Error("No access to this workspace.");
      error.status = 403;
      throw error;
    }
    return requested;
  }

  return memberships[0]?.workspace_id || null;
}

async function resolveWorkspaceForAssetWrite(token, user, requestedWorkspaceId) {
  const memberships = await getWorkspaceMemberships(token, user.id);
  const editableMemberships = memberships.filter(
    (row) => row.role === "owner" || row.role === "editor"
  );
  const requested = sanitizeWorkspaceId(requestedWorkspaceId);

  if (requested) {
    const membership = editableMemberships.find((row) => row.workspace_id === requested);
    if (!membership) {
      const error = new Error("No permission to upload assets to this workspace.");
      error.status = 403;
      throw error;
    }
    return requested;
  }

  if (editableMemberships.length > 0) {
    return editableMemberships[0].workspace_id;
  }

  return ensureWorkspaceForUser(token, user);
}

async function listLibraryAssetsRows(token, workspaceId, type) {
  const params = [
    "select=id,type,title,source,file_url,thumbnail_url,mime_type,file_size_bytes,width,height,workspace_id,owner_id,is_active,s3_key,metadata_json,created_at,updated_at",
    "is_active=eq.true",
    "order=source.asc,updated_at.desc",
  ];

  if (type) {
    params.push(`type=eq.${encodeURIComponent(type)}`);
  }

  if (workspaceId) {
    params.push(`or=(source.eq.preinstalled,workspace_id.eq.${encodeURIComponent(workspaceId)})`);
  } else {
    params.push("source=eq.preinstalled");
  }

  return supabaseRest(`/library_assets?${params.join("&")}`, { token });
}

async function getLibraryAssetRowById(token, assetId) {
  const rows = await supabaseRest(
    `/library_assets?select=id,type,title,source,file_url,thumbnail_url,mime_type,file_size_bytes,width,height,workspace_id,owner_id,is_active,s3_key,metadata_json,created_at,updated_at&id=eq.${encodeURIComponent(assetId)}&limit=1`,
    { token }
  );

  return rows[0] || null;
}

function mapDialog(simulator, publication) {
  return {
    id: simulator.id,
    workspaceId: simulator.workspace_id,
    name: simulator.name,
    description: simulator.description || "",
    status: simulator.status,
    createdAt: simulator.created_at,
    updatedAt: simulator.updated_at,
    published: Boolean(publication && publication.is_active),
    publicationId: publication?.id || null,
    publicationKey: publication?.publication_key || null,
    publishedAt: publication?.published_at || null,
  };
}

function sanitizeDialogName(name) {
  const fallback = "Новый диалог";
  const value = String(name || "").trim();
  if (!value) {
    return fallback;
  }

  return value.slice(0, 140);
}

function sanitizeDialogDescription(description) {
  return String(description || "").trim().slice(0, 1200);
}

function sanitizeSceneType(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "dialog") {
    return "dialog";
  }

  return "messenger";
}

function buildExportArtifacts(publicationId, publicationKey) {
  const iframeSrc = `${PLAYER_BASE_URL}/p/${publicationKey}`;
  const iframeSnippet = `<iframe src=\"${iframeSrc}\" width=\"100%\" height=\"720\" frameborder=\"0\" allowfullscreen></iframe>`;
  const scriptSnippet = `<script src=\"${PLAYER_BASE_URL}/embed.js\" data-publication=\"${publicationKey}\"></script>`;
  const htmlUrl = `${PLAYER_BASE_URL}/export/${publicationKey}.html`;

  return [
    {
      publication_id: publicationId,
      type: "iframe",
      url_or_snippet: iframeSnippet,
      content_hash: crypto.createHash("sha1").update(iframeSnippet).digest("hex"),
    },
    {
      publication_id: publicationId,
      type: "script",
      url_or_snippet: scriptSnippet,
      content_hash: crypto.createHash("sha1").update(scriptSnippet).digest("hex"),
    },
    {
      publication_id: publicationId,
      type: "html",
      url_or_snippet: htmlUrl,
      content_hash: crypto.createHash("sha1").update(htmlUrl).digest("hex"),
    },
  ];
}

function cleanupExpiredTempPreviewSessions() {
  const now = Date.now();
  tempPreviewSessions.forEach((session, token) => {
    const expiresAtMs = Number(session?.expiresAtMs || 0);
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now) {
      tempPreviewSessions.delete(token);
    }
  });
}

function createTempPreviewToken() {
  return crypto.randomBytes(24).toString("hex");
}

function collectPreviewAssetIds(graph) {
  const characterIds = new Set();
  const backgroundIds = new Set();
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];

  nodes.forEach((node) => {
    if (!node || node.type !== "message") {
      return;
    }

    const characterId = String(node?.data?.characterAssetId || "").trim();
    const backgroundId = String(node?.data?.backgroundAssetId || "").trim();

    if (characterId) {
      characterIds.add(characterId);
    }
    if (backgroundId) {
      backgroundIds.add(backgroundId);
    }
  });

  return {
    characterIds: Array.from(characterIds),
    backgroundIds: Array.from(backgroundIds),
  };
}

async function getLibraryAssetsByIds(token, assetIds) {
  const ids = Array.isArray(assetIds)
    ? assetIds
      .map((id) => String(id || "").trim())
      .filter((id) => Boolean(id))
      .slice(0, 200)
    : [];

  if (ids.length === 0) {
    return [];
  }

  const rows = await supabaseRest(
    `/library_assets?select=id,type,title,source,file_url,thumbnail_url,mime_type,file_size_bytes,width,height,workspace_id,owner_id,is_active,s3_key,metadata_json,created_at,updated_at&id=in.(${ids
      .map((id) => encodeURIComponent(id))
      .join(",")})&is_active=eq.true`,
    { token }
  );

  const mapped = await Promise.all((Array.isArray(rows) ? rows : []).map((row) => mapLibraryAsset(row)));
  return mapped.filter((asset) => Boolean(asset && asset.id));
}

async function buildPreviewAssetCatalog(token, graph) {
  const { characterIds, backgroundIds } = collectPreviewAssetIds(graph);
  const [characters, backgrounds] = await Promise.all([
    getLibraryAssetsByIds(token, characterIds),
    getLibraryAssetsByIds(token, backgroundIds),
  ]);

  return {
    character: characters.filter((asset) => asset.type === "character"),
    background: backgrounds.filter((asset) => asset.type === "background"),
  };
}

const EDITOR_NODE_TYPES = new Set(["start", "message", "response", "end"]);

function buildDefaultEditorGraph() {
  return {
    version: 1,
    viewport: { zoom: 100, x: 0, y: 0 },
    nodes: [
      {
        id: "node_start",
        type: "start",
        position: { x: 520, y: 80 },
        data: {
          title: "Scenario Initialization",
          passScore: null,
          maxAttempts: null,
        },
      },
    ],
    edges: [],
  };
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, parsed));
}

function sanitizeOptionalInteger(value, min, max) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  const normalized = Math.trunc(parsed);
  if (normalized < min || normalized > max) {
    return null;
  }

  return normalized;
}

function sanitizeNodeId(value, fallback) {
  const normalized = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 80);

  return normalized || fallback;
}

function sanitizeNodeType(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return EDITOR_NODE_TYPES.has(normalized) ? normalized : null;
}

function sanitizeNodeDataByType(type, dataInput) {
  const data = ensureJsonObject(dataInput) ? dataInput : {};

  if (type === "start") {
    const passScore = sanitizeOptionalInteger(
      data.passScore ?? data.passThreshold ?? data.passingScore,
      0,
      100000
    );
    const maxAttempts = sanitizeOptionalInteger(data.maxAttempts ?? data.attemptLimit, 1, 1000);

    return {
      title: String(data.title || "Scenario Initialization").trim().slice(0, 120) || "Scenario Initialization",
      passScore,
      maxAttempts,
    };
  }

  if (type === "message") {
    const emotionState = String(data.emotionState || "")
      .trim()
      .toLowerCase();

    return {
      speakerType: String(data.speakerType || "npc").trim().toLowerCase() === "system" ? "system" : "npc",
      speakerName: String(data.speakerName || "NPC").trim().slice(0, 80) || "NPC",
      text: String(data.text || "").trim().slice(0, 4000),
      characterAssetId: data.characterAssetId ? sanitizeNodeId(data.characterAssetId, "") : null,
      backgroundAssetId: data.backgroundAssetId ? sanitizeNodeId(data.backgroundAssetId, "") : null,
      emotionState: ["neutral", "happy", "concerned", "angry"].includes(emotionState)
        ? emotionState
        : "neutral",
      mediaRef: data.mediaRef ? String(data.mediaRef).trim().slice(0, 120) : null,
    };
  }

  if (type === "response") {
    const hintEnabled = Boolean(data.hintEnabled);
    return {
      responseText: String(data.responseText || "").trim().slice(0, 4000),
      scoreDelta: Math.trunc(clampNumber(data.scoreDelta, -1000, 1000, 0)),
      feedbackType: ["positive", "neutral", "negative"].includes(String(data.feedbackType || "").trim().toLowerCase())
        ? String(data.feedbackType || "").trim().toLowerCase()
        : "neutral",
      hintEnabled,
      hintText: hintEnabled ? String(data.hintText || "").trim().slice(0, 1200) : "",
      nextStepRef: data.nextStepRef ? sanitizeNodeId(data.nextStepRef, "") : null,
    };
  }

  return {
    endingType: ["success", "fail", "neutral"].includes(String(data.endingType || "").trim().toLowerCase())
      ? String(data.endingType || "").trim().toLowerCase()
      : "neutral",
    title: String(data.title || "Outcome").trim().slice(0, 120) || "Outcome",
    description: String(data.description || "").trim().slice(0, 1200),
  };
}

function isEditorEdgeAllowed(sourceType, targetType) {
  if (sourceType === "start") {
    return targetType === "message";
  }

  if (sourceType === "message") {
    return targetType === "response" || targetType === "end";
  }

  if (sourceType === "response") {
    return targetType === "message" || targetType === "end";
  }

  return false;
}

function sanitizeEditorGraph(inputGraph) {
  const fallback = buildDefaultEditorGraph();
  const graph = ensureJsonObject(inputGraph) ? inputGraph : {};

  const normalizedNodes = [];
  const byId = new Map();

  const inputNodes = Array.isArray(graph.nodes) ? graph.nodes.slice(0, 500) : [];
  inputNodes.forEach((rawNode, index) => {
    if (!ensureJsonObject(rawNode)) {
      return;
    }

    const type = sanitizeNodeType(rawNode.type);
    if (!type) {
      return;
    }

    const id = sanitizeNodeId(rawNode.id, `node_${type}_${index + 1}`);
    if (byId.has(id)) {
      return;
    }

    const node = {
      id,
      type,
      position: {
        x: Math.trunc(clampNumber(rawNode?.position?.x, 0, 4000, 120 + index * 20)),
        y: Math.trunc(clampNumber(rawNode?.position?.y, 0, 4000, 120 + index * 20)),
      },
      data: sanitizeNodeDataByType(type, rawNode.data),
    };

    byId.set(id, node);
    normalizedNodes.push(node);
  });

  const startNodes = normalizedNodes.filter((node) => node.type === "start");
  if (startNodes.length === 0) {
    const defaultStart = fallback.nodes[0];
    normalizedNodes.unshift(defaultStart);
    byId.set(defaultStart.id, defaultStart);
  } else if (startNodes.length > 1) {
    const keepStartId = startNodes[0].id;
    const filtered = normalizedNodes.filter((node) => node.type !== "start" || node.id === keepStartId);
    normalizedNodes.length = 0;
    filtered.forEach((node) => normalizedNodes.push(node));
    byId.clear();
    normalizedNodes.forEach((node) => byId.set(node.id, node));
  }

  const inputEdges = Array.isArray(graph.edges) ? graph.edges.slice(0, 1000) : [];
  const normalizedEdges = [];
  const edgeKeys = new Set();
  const responseOutgoing = new Map();

  inputEdges.forEach((rawEdge, index) => {
    if (!ensureJsonObject(rawEdge)) {
      return;
    }

    const source = sanitizeNodeId(rawEdge.source, "");
    const target = sanitizeNodeId(rawEdge.target, "");
    if (!source || !target || source === target) {
      return;
    }

    const sourceNode = byId.get(source);
    const targetNode = byId.get(target);
    if (!sourceNode || !targetNode) {
      return;
    }

    if (sourceNode.type === "end" || targetNode.type === "start") {
      return;
    }

    if (!isEditorEdgeAllowed(sourceNode.type, targetNode.type)) {
      return;
    }

    if (sourceNode.type === "response") {
      const currentCount = Number(responseOutgoing.get(source) || 0);
      if (currentCount >= 1) {
        return;
      }
      responseOutgoing.set(source, currentCount + 1);
    }

    const key = `${source}->${target}`;
    if (edgeKeys.has(key)) {
      return;
    }
    edgeKeys.add(key);

    normalizedEdges.push({
      id: sanitizeNodeId(rawEdge.id, `edge_${index + 1}`),
      source,
      target,
    });
  });

  return {
    version: 1,
    viewport: {
      zoom: Math.trunc(clampNumber(graph?.viewport?.zoom, 25, 200, 100)),
      x: Math.trunc(clampNumber(graph?.viewport?.x, -10000, 10000, 0)),
      y: Math.trunc(clampNumber(graph?.viewport?.y, -10000, 10000, 0)),
    },
    nodes: normalizedNodes,
    edges: normalizedEdges,
  };
}

async function getLatestScenarioVersion(token, simulatorId) {
  const rows = await supabaseRest(
    `/scenario_versions?select=id,simulator_id,version_number,state,schema_version,title,locale,start_step_key,metadata_json,updated_at&simulator_id=eq.${encodeURIComponent(simulatorId)}&order=version_number.desc&limit=1`,
    { token }
  );

  return rows[0] || null;
}

async function getActivePublicationForSimulator(token, simulatorId) {
  const rows = await supabaseRest(
    `/publications?select=id,simulator_id,publication_key,published_at,is_active&simulator_id=eq.${encodeURIComponent(simulatorId)}&is_active=eq.true&order=published_at.desc&limit=1`,
    { token }
  );

  return rows[0] || null;
}

async function createInitialScenarioVersion(token, simulator, userId) {
  const defaultGraph = buildDefaultEditorGraph();
  const inserted = await supabaseRest("/scenario_versions", {
    method: "POST",
    token,
    prefer: "return=representation",
    body: {
      simulator_id: simulator.id,
      version_number: 1,
      state: "draft",
      schema_version: "1.0.0",
      title: simulator.name,
      locale: "ru-RU",
      start_step_key: "node_start",
      metadata_json: { editor_graph: defaultGraph },
      created_by: userId,
    },
  });

  return inserted[0] || null;
}

async function copyScenarioRows(token, sourceVersionId, targetVersionId) {
  const steps = await supabaseRest(
    `/scenario_steps?select=step_key,type,speaker,content,media_asset_id,order_index&scenario_version_id=eq.${encodeURIComponent(sourceVersionId)}`,
    { token }
  );

  if (steps.length > 0) {
    await supabaseRest("/scenario_steps", {
      method: "POST",
      token,
      body: steps.map((row) => ({ ...row, scenario_version_id: targetVersionId })),
      prefer: "return=minimal",
    });
  }

  const choices = await supabaseRest(
    `/scenario_choices?select=choice_key,from_step_key,next_step_key,label,condition_json,score_delta,feedback,order_index&scenario_version_id=eq.${encodeURIComponent(sourceVersionId)}`,
    { token }
  );

  if (choices.length > 0) {
    await supabaseRest("/scenario_choices", {
      method: "POST",
      token,
      body: choices.map((row) => ({ ...row, scenario_version_id: targetVersionId })),
      prefer: "return=minimal",
    });
  }

  const endings = await supabaseRest(
    `/scenario_endings?select=ending_key,title,description,rule_json,score_min,score_max,priority&scenario_version_id=eq.${encodeURIComponent(sourceVersionId)}`,
    { token }
  );

  if (endings.length > 0) {
    await supabaseRest("/scenario_endings", {
      method: "POST",
      token,
      body: endings.map((row) => ({ ...row, scenario_version_id: targetVersionId })),
      prefer: "return=minimal",
    });
  }

  const scoringPolicies = await supabaseRest(
    `/scoring_policies?select=mode,max_score,pass_threshold,rules_json&scenario_version_id=eq.${encodeURIComponent(sourceVersionId)}&limit=1`,
    { token }
  );

  if (scoringPolicies[0]) {
    await supabaseRest("/scoring_policies", {
      method: "POST",
      token,
      body: {
        scenario_version_id: targetVersionId,
        mode: scoringPolicies[0].mode,
        max_score: scoringPolicies[0].max_score,
        pass_threshold: scoringPolicies[0].pass_threshold,
        rules_json: scoringPolicies[0].rules_json,
      },
      prefer: "return=minimal",
    });
  }

  const uiConfigs = await supabaseRest(
    `/ui_configs?select=theme_json,branding_json,player_json&scenario_version_id=eq.${encodeURIComponent(sourceVersionId)}&limit=1`,
    { token }
  );

  if (uiConfigs[0]) {
    await supabaseRest("/ui_configs", {
      method: "POST",
      token,
      body: {
        scenario_version_id: targetVersionId,
        theme_json: uiConfigs[0].theme_json,
        branding_json: uiConfigs[0].branding_json,
        player_json: uiConfigs[0].player_json,
      },
      prefer: "return=minimal",
    });
  }
}

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, service: "dialog-trainer-backend" });
});

app.post("/api/v1/auth/register", async (req, res) => {
  if (!ensureJsonObject(req.body)) {
    return res.status(400).json({
      error: "Request body must be a JSON object.",
    });
  }

  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    return res.status(500).json({
      error: "Backend is not configured. Missing SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY.",
    });
  }

  const fullName = String(req.body.fullName || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");

  const signupUrl = `${SUPABASE_URL.replace(/\/+$/, "")}/auth/v1/signup`;

  try {
    const response = await fetch(signupUrl, {
      method: "POST",
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        password,
        data: {
          full_name: fullName,
        },
      }),
    });

    const data = await fetchJsonSafe(response);

    if (!response.ok) {
      const message =
        data.msg ||
        data.error_description ||
        data.error ||
        "Supabase signup failed.";

      return res.status(response.status).json({
        error: message,
      });
    }

    return res.status(201).json({
      user: data.user || null,
      session: data.session || null,
      emailConfirmationRequired: data.session == null,
    });
  } catch (error) {
    return res.status(502).json({
      error: "Unable to reach Supabase Auth.",
      details: String(error && error.message ? error.message : error),
    });
  }
});

app.post("/api/v1/auth/login", async (req, res) => {
  if (!ensureJsonObject(req.body)) {
    return res.status(400).json({
      error: "Request body must be a JSON object.",
    });
  }

  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    return res.status(500).json({
      error: "Backend is not configured. Missing SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY.",
    });
  }

  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const loginUrl = `${SUPABASE_URL.replace(/\/+$/, "")}/auth/v1/token?grant_type=password`;

  try {
    const response = await fetch(loginUrl, {
      method: "POST",
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        password,
      }),
    });

    const data = await fetchJsonSafe(response);

    if (!response.ok) {
      const message =
        data.msg ||
        data.error_description ||
        data.error ||
        "Supabase login failed.";

      return res.status(response.status).json({
        error: message,
      });
    }

    return res.status(200).json({
      user: data.user || null,
      session: data,
      accessToken: data.access_token || null,
      refreshToken: data.refresh_token || null,
      expiresIn: data.expires_in || null,
      tokenType: data.token_type || null,
    });
  } catch (error) {
    return res.status(502).json({
      error: "Unable to reach Supabase Auth.",
      details: String(error && error.message ? error.message : error),
    });
  }
});

app.get("/api/v1/auth/me", async (req, res) => {
  const context = await requireUserContext(req, res);
  if (!context) {
    return;
  }

  res.status(200).json({ user: context.user });
});

function runAssetUploadMiddleware(req, res) {
  return new Promise((resolve, reject) => {
    assetUpload.single("file")(req, res, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

app.get("/api/v1/assets", async (req, res) => {
  const context = await requireUserContext(req, res);
  if (!context) {
    return;
  }

  const assetType = sanitizeAssetType(req.query.type);
  if (req.query.type && !assetType) {
    return res.status(400).json({ error: "Invalid asset type. Use character or background." });
  }

  try {
    const workspaceId = await resolveWorkspaceForAssetRead(
      context.token,
      context.user,
      req.query.workspaceId
    );

    const rows = await listLibraryAssetsRows(context.token, workspaceId, assetType);
    const items = await Promise.all(rows.map((row) => mapLibraryAsset(row)));

    return res.status(200).json({
      workspaceId,
      items,
      count: items.length,
      limits: {
        characterMaxBytes: ASSET_CHARACTER_MAX_BYTES,
        backgroundMaxBytes: ASSET_BACKGROUND_MAX_BYTES,
      },
    });
  } catch (error) {
    const payload = formatErrorPayload(error, "Unable to load assets.");
    return res.status(error.status || 500).json(payload);
  }
});

app.post("/api/v1/assets", async (req, res) => {
  const context = await requireUserContext(req, res);
  if (!context) {
    return;
  }

  try {
    await runAssetUploadMiddleware(req, res);
  } catch (error) {
    if (error instanceof multer.MulterError) {
      if (error.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ error: "File is too large for upload." });
      }
      return res.status(400).json({ error: error.message || "Upload validation failed." });
    }
    return res.status(400).json({ error: "Unable to parse upload payload." });
  }

  const assetType = sanitizeAssetType(req.body?.type);
  const title = sanitizeAssetTitle(req.body?.title);
  const file = req.file;

  if (!assetType) {
    return res.status(400).json({ error: "Asset type is required (character/background)." });
  }

  if (!title) {
    return res.status(400).json({ error: "Asset title is required." });
  }

  if (!file) {
    return res.status(400).json({ error: "File is required." });
  }

  const normalizedMime = String(file.mimetype || "").trim().toLowerCase();
  if (!ASSET_ALLOWED_MIME[assetType].has(normalizedMime)) {
    return res.status(400).json({
      error: `Unsupported file format for ${assetType}.`,
    });
  }

  const sizeLimit = getAssetSizeLimit(assetType);
  if (Number(file.size || 0) > sizeLimit) {
    return res.status(400).json({
      error: `File exceeds maximum allowed size (${sizeLimit} bytes).`,
    });
  }

  try {
    const workspaceId = await resolveWorkspaceForAssetWrite(
      context.token,
      context.user,
      req.body?.workspaceId
    );

    const extension = getUploadExtFromMime(normalizedMime);
    const assetId = crypto.randomUUID();
    const objectKey = `${LOCAL_ASSET_PREFIX}/${workspaceId}/${assetType}/${assetId}.${extension}`;
    const { width, height } = parseImageDimensions(file.buffer);
    const fileUrl = await putAssetObject(objectKey, file.buffer, normalizedMime);

    let insertedRow = null;
    try {
      insertedRow = (
        await supabaseRest("/library_assets", {
          method: "POST",
          token: context.token,
          prefer: "return=representation",
          body: {
            id: assetId,
            type: assetType,
            title,
            source: "user_upload",
            file_url: fileUrl,
            thumbnail_url: fileUrl,
            mime_type: normalizedMime,
            file_size_bytes: Number(file.size || 0),
            width,
            height,
            workspace_id: workspaceId,
            owner_id: context.user.id,
            s3_key: objectKey,
            metadata_json: {
              originalFilename: String(file.originalname || "").slice(0, 260),
              storageDriver: ASSET_STORAGE_DRIVER,
            },
            is_active: true,
          },
        })
      )[0];
    } catch (error) {
      await deleteAssetObject(objectKey, fileUrl);
      throw error;
    }

    const mapped = await mapLibraryAsset(insertedRow);
    return res.status(201).json({ item: mapped });
  } catch (error) {
    const payload = formatErrorPayload(error, "Unable to upload asset.");
    return res.status(error.status || 500).json(payload);
  }
});

app.get("/api/v1/assets/:id", async (req, res) => {
  const context = await requireUserContext(req, res);
  if (!context) {
    return;
  }

  const assetId = String(req.params.id || "").trim();
  if (!assetId) {
    return res.status(400).json({ error: "Asset id is required." });
  }

  try {
    const row = await getLibraryAssetRowById(context.token, assetId);
    if (!row || !row.is_active) {
      return res.status(404).json({ error: "Asset not found." });
    }

    const item = await mapLibraryAsset(row);
    return res.status(200).json({ item });
  } catch (error) {
    const payload = formatErrorPayload(error, "Unable to load asset.");
    return res.status(error.status || 500).json(payload);
  }
});

app.patch("/api/v1/assets/:id", async (req, res) => {
  const context = await requireUserContext(req, res);
  if (!context) {
    return;
  }

  if (!ensureJsonObject(req.body)) {
    return res.status(400).json({ error: "Request body must be a JSON object." });
  }

  const assetId = String(req.params.id || "").trim();
  if (!assetId) {
    return res.status(400).json({ error: "Asset id is required." });
  }

  try {
    const row = await getLibraryAssetRowById(context.token, assetId);
    if (!row || !row.is_active) {
      return res.status(404).json({ error: "Asset not found." });
    }

    if (row.type !== "character") {
      return res.status(400).json({ error: "Only character assets support profile editing." });
    }

    if (row.source !== "user_upload") {
      return res.status(403).json({ error: "Preinstalled assets cannot be edited." });
    }

    const membership = await getMembershipForWorkspace(
      context.token,
      context.user.id,
      row.workspace_id
    );

    if (!membership || (membership.role !== "owner" && membership.role !== "editor")) {
      return res.status(403).json({ error: "No permission to edit this asset." });
    }

    const patch = {};
    if (Object.prototype.hasOwnProperty.call(req.body, "title")) {
      const title = sanitizeAssetTitle(req.body?.title);
      if (!title) {
        return res.status(400).json({ error: "Title is required." });
      }
      patch.title = title;
    }

    const metadata = ensurePlainObject(row.metadata_json) ? { ...row.metadata_json } : {};
    let metadataChanged = false;

    if (Object.prototype.hasOwnProperty.call(req.body, "specialization")) {
      const value = String(req.body?.specialization || "").trim().slice(0, 120);
      metadata.specialization = value || null;
      metadataChanged = true;
    }

    if (Object.prototype.hasOwnProperty.call(req.body, "description")) {
      const value = String(req.body?.description || "").trim().slice(0, 2000);
      metadata.description = value || null;
      metadataChanged = true;
    }

    if (!patch.title && !metadataChanged) {
      return res.status(400).json({ error: "No editable fields were provided." });
    }

    if (metadataChanged) {
      metadata.emotions_count = countEmotionImagesFromMetadata(metadata);
      patch.metadata_json = metadata;
    }

    const updatedRows = await supabaseRest(`/library_assets?id=eq.${encodeURIComponent(assetId)}`, {
      method: "PATCH",
      token: context.token,
      prefer: "return=representation",
      body: patch,
    });

    const updated = updatedRows[0] || row;
    const item = await mapLibraryAsset(updated);
    return res.status(200).json({ item });
  } catch (error) {
    const payload = formatErrorPayload(error, "Unable to update asset.");
    return res.status(error.status || 500).json(payload);
  }
});

app.post("/api/v1/assets/:id/emotions/:state", async (req, res) => {
  const context = await requireUserContext(req, res);
  if (!context) {
    return;
  }

  const assetId = String(req.params.id || "").trim();
  if (!assetId) {
    return res.status(400).json({ error: "Asset id is required." });
  }

  const emotionState = sanitizeCharacterEmotionState(req.params.state);
  if (!emotionState) {
    return res.status(400).json({ error: "Unsupported emotion state." });
  }

  try {
    await runAssetUploadMiddleware(req, res);
  } catch (error) {
    if (error instanceof multer.MulterError) {
      if (error.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ error: "File is too large for upload." });
      }
      return res.status(400).json({ error: error.message || "Upload validation failed." });
    }
    return res.status(400).json({ error: "Unable to parse upload payload." });
  }

  const file = req.file;
  if (!file) {
    return res.status(400).json({ error: "File is required." });
  }

  const normalizedMime = String(file.mimetype || "").trim().toLowerCase();
  if (!CHARACTER_EMOTION_ALLOWED_MIME.has(normalizedMime)) {
    return res.status(400).json({ error: "Unsupported emotion image format." });
  }

  if (Number(file.size || 0) > ASSET_CHARACTER_MAX_BYTES) {
    return res.status(400).json({
      error: `File exceeds maximum allowed size (${ASSET_CHARACTER_MAX_BYTES} bytes).`,
    });
  }

  try {
    const row = await getLibraryAssetRowById(context.token, assetId);
    if (!row || !row.is_active) {
      return res.status(404).json({ error: "Asset not found." });
    }

    if (row.type !== "character") {
      return res.status(400).json({ error: "Emotion uploads are allowed only for characters." });
    }

    if (row.source !== "user_upload") {
      return res.status(403).json({ error: "Preinstalled assets cannot be edited." });
    }

    const membership = await getMembershipForWorkspace(
      context.token,
      context.user.id,
      row.workspace_id
    );

    if (!membership || (membership.role !== "owner" && membership.role !== "editor")) {
      return res.status(403).json({ error: "No permission to edit this asset." });
    }

    const extension = getUploadExtFromMime(normalizedMime);
    const uploadId = crypto.randomUUID();
    const objectKey = `${LOCAL_ASSET_PREFIX}/${row.workspace_id}/character-emotions/${row.id}/${emotionState}-${uploadId}.${extension}`;
    const fileUrl = await putAssetObject(objectKey, file.buffer, normalizedMime);

    const metadata = ensurePlainObject(row.metadata_json) ? { ...row.metadata_json } : {};
    const emotionImages = ensurePlainObject(metadata.emotionImages) ? { ...metadata.emotionImages } : {};
    const emotionImageKeys = ensurePlainObject(metadata.emotionImageKeys)
      ? { ...metadata.emotionImageKeys }
      : {};

    const previousUrl = String(emotionImages[emotionState] || "").trim() || null;
    const previousKey =
      normalizeAssetObjectKey(emotionImageKeys[emotionState] || "") ||
      resolveObjectKeyFromAssetUrl(previousUrl);

    emotionImages[emotionState] = fileUrl;
    emotionImageKeys[emotionState] = objectKey;

    metadata.emotionImages = emotionImages;
    metadata.emotionImageKeys = emotionImageKeys;
    metadata.emotions_count = countEmotionImagesFromMetadata(metadata);

    let updatedRows = [];
    try {
      updatedRows = await supabaseRest(`/library_assets?id=eq.${encodeURIComponent(assetId)}`, {
        method: "PATCH",
        token: context.token,
        prefer: "return=representation",
        body: {
          metadata_json: metadata,
        },
      });
    } catch (error) {
      await deleteAssetObject(objectKey, fileUrl);
      throw error;
    }

    if (previousKey && previousKey !== objectKey) {
      await deleteAssetObject(previousKey, previousUrl || "");
    }

    const updated = updatedRows[0] || row;
    const item = await mapLibraryAsset(updated);
    return res.status(200).json({ item });
  } catch (error) {
    const payload = formatErrorPayload(error, "Unable to upload emotion image.");
    return res.status(error.status || 500).json(payload);
  }
});

app.delete("/api/v1/assets/:id", async (req, res) => {
  const context = await requireUserContext(req, res);
  if (!context) {
    return;
  }

  const assetId = String(req.params.id || "").trim();
  if (!assetId) {
    return res.status(400).json({ error: "Asset id is required." });
  }

  try {
    const row = (
      await supabaseRest(
        `/library_assets?select=id,source,workspace_id,s3_key,file_url,metadata_json,is_active&id=eq.${encodeURIComponent(assetId)}&limit=1`,
        { token: context.token }
      )
    )[0];

    if (!row || !row.is_active) {
      return res.status(404).json({ error: "Asset not found." });
    }

    if (row.source !== "user_upload") {
      return res.status(403).json({ error: "Preinstalled assets cannot be deleted." });
    }

    const membership = await getMembershipForWorkspace(
      context.token,
      context.user.id,
      row.workspace_id
    );

    if (!membership || (membership.role !== "owner" && membership.role !== "editor")) {
      return res.status(403).json({ error: "No permission to delete this asset." });
    }

    await supabaseRest(`/library_assets?id=eq.${encodeURIComponent(assetId)}`, {
      method: "PATCH",
      token: context.token,
      prefer: "return=minimal",
      body: {
        is_active: false,
      },
    });

    if (row.s3_key) {
      await deleteAssetObject(row.s3_key, row.file_url);
    }

    const emotionRefs = collectEmotionAssetRefs(row.metadata_json);
    for (const ref of emotionRefs) {
      await deleteAssetObject(ref.key, ref.url);
    }

    return res.status(204).send();
  } catch (error) {
    const payload = formatErrorPayload(error, "Unable to delete asset.");
    return res.status(error.status || 500).json(payload);
  }
});

app.get("/api/v1/builder/dialogs", async (req, res) => {
  const context = await requireUserContext(req, res);
  if (!context) {
    return;
  }

  try {
    const memberships = await getWorkspaceMemberships(context.token, context.user.id);
    const workspaceIds = memberships.map((row) => row.workspace_id);

    if (workspaceIds.length === 0) {
      return res.status(200).json({ items: [], count: 0 });
    }

    const sortParam = String(req.query.sort || "updated_at_desc");
    const sortClause = sortParam === "updated_at_asc" ? "updated_at.asc" : "updated_at.desc";
    const workspaceInClause = workspaceIds.join(",");

    const simulators = await supabaseRest(
      `/simulators?select=id,workspace_id,name,description,status,created_by,created_at,updated_at&workspace_id=in.(${workspaceInClause})&status=neq.archived&order=${sortClause}`,
      { token: context.token }
    );

    if (simulators.length === 0) {
      return res.status(200).json({ items: [], count: 0 });
    }

    const simulatorIds = simulators.map((row) => row.id);
    const publicationRows = await supabaseRest(
      `/publications?select=id,simulator_id,publication_key,published_at,is_active&simulator_id=in.(${simulatorIds.join(",")})&is_active=eq.true&order=published_at.desc`,
      { token: context.token }
    );

    const publicationBySimulatorId = new Map();
    publicationRows.forEach((row) => {
      if (!publicationBySimulatorId.has(row.simulator_id)) {
        publicationBySimulatorId.set(row.simulator_id, row);
      }
    });

    const items = simulators.map((simulator) =>
      mapDialog(simulator, publicationBySimulatorId.get(simulator.id) || null)
    );

    return res.status(200).json({ items, count: items.length });
  } catch (error) {
    const payload = formatErrorPayload(error, "Unable to load dialogs.");
    return res.status(error.status || 500).json(payload);
  }
});

app.post("/api/v1/builder/dialogs", async (req, res) => {
  const context = await requireUserContext(req, res);
  if (!context) {
    return;
  }

  try {
    const name = sanitizeDialogName(req.body?.name);
    const description = sanitizeDialogDescription(req.body?.description);
    const sceneType = sanitizeSceneType(req.body?.sceneType);
    const requestedWorkspaceId = String(req.body?.workspaceId || "").trim();

    const memberships = await getWorkspaceMemberships(context.token, context.user.id);
    const editorMemberships = memberships.filter((row) => row.role === "owner" || row.role === "editor");

    let workspaceId = null;

    if (requestedWorkspaceId) {
      const membership = editorMemberships.find((row) => row.workspace_id === requestedWorkspaceId);
      if (!membership) {
        return res.status(403).json({ error: "No permission to create dialog in this workspace." });
      }
      workspaceId = requestedWorkspaceId;
    } else if (editorMemberships.length > 0) {
      workspaceId = editorMemberships[0].workspace_id;
    } else {
      workspaceId = await ensureWorkspaceForUser(context.token, context.user);
    }

    const insertedSimulators = await supabaseRest("/simulators", {
      method: "POST",
      token: context.token,
      prefer: "return=representation",
      body: {
        workspace_id: workspaceId,
        name,
        description: description || null,
        status: "draft",
        created_by: context.user.id,
      },
    });

    const simulator = insertedSimulators[0];

    const insertedScenarioVersions = await supabaseRest("/scenario_versions", {
      method: "POST",
      token: context.token,
      prefer: "return=representation",
      body: {
        simulator_id: simulator.id,
        version_number: 1,
        state: "draft",
        schema_version: "1.0.0",
        title: name,
        locale: "ru-RU",
        start_step_key: "node_start",
        metadata_json: {
          editor_graph: buildDefaultEditorGraph(),
          scene_type: sceneType,
        },
        created_by: context.user.id,
      },
    });

    const scenarioVersion = insertedScenarioVersions[0];

    await supabaseRest("/scoring_policies", {
      method: "POST",
      token: context.token,
      prefer: "return=minimal",
      body: {
        scenario_version_id: scenarioVersion.id,
        mode: "sum",
        max_score: 100,
        pass_threshold: 70,
        rules_json: [],
      },
    });

    await supabaseRest("/ui_configs", {
      method: "POST",
      token: context.token,
      prefer: "return=minimal",
      body: {
        scenario_version_id: scenarioVersion.id,
        theme_json: { theme: "light" },
        branding_json: {},
        player_json: { scene_type: sceneType },
      },
    });

    return res.status(201).json({ item: mapDialog(simulator, null) });
  } catch (error) {
    const payload = formatErrorPayload(error, "Unable to create dialog.");
    return res.status(error.status || 500).json(payload);
  }
});

app.get("/api/v1/builder/dialogs/:id/editor", async (req, res) => {
  const context = await requireUserContext(req, res);
  if (!context) {
    return;
  }

  const simulatorId = String(req.params.id || "").trim();

  try {
    const simulator = await getSimulatorById(context.token, simulatorId);
    if (!simulator) {
      return res.status(404).json({ error: "Dialog not found." });
    }

    const membership = await getMembershipForWorkspace(
      context.token,
      context.user.id,
      simulator.workspace_id
    );

    if (!membership) {
      return res.status(403).json({ error: "No access to this dialog." });
    }

    let scenarioVersion = await getLatestScenarioVersion(context.token, simulator.id);

    if (!scenarioVersion) {
      if (membership.role !== "owner" && membership.role !== "editor") {
        return res.status(404).json({ error: "No scenario draft found." });
      }

      scenarioVersion = await createInitialScenarioVersion(context.token, simulator, context.user.id);
    }

    const graph = sanitizeEditorGraph(scenarioVersion?.metadata_json?.editor_graph || null);
    const sceneType = sanitizeSceneType(scenarioVersion?.metadata_json?.scene_type);

    return res.status(200).json({
      dialogId: simulator.id,
      dialogName: simulator.name,
      sceneType,
      scenarioVersionId: scenarioVersion.id,
      scenarioState: scenarioVersion.state,
      revision: scenarioVersion.updated_at || null,
      graph,
    });
  } catch (error) {
    const payload = formatErrorPayload(error, "Unable to load editor graph.");
    return res.status(error.status || 500).json(payload);
  }
});

app.put("/api/v1/builder/dialogs/:id/editor", async (req, res) => {
  const context = await requireUserContext(req, res);
  if (!context) {
    return;
  }

  if (!ensureJsonObject(req.body)) {
    return res.status(400).json({ error: "Request body must be a JSON object." });
  }

  const simulatorId = String(req.params.id || "").trim();

  try {
    const simulator = await getSimulatorById(context.token, simulatorId);
    if (!simulator) {
      return res.status(404).json({ error: "Dialog not found." });
    }

    const membership = await getMembershipForWorkspace(
      context.token,
      context.user.id,
      simulator.workspace_id
    );

    if (!membership || (membership.role !== "owner" && membership.role !== "editor")) {
      return res.status(403).json({ error: "No permission to edit this dialog." });
    }

    let scenarioVersion = await getLatestScenarioVersion(context.token, simulator.id);
    if (!scenarioVersion) {
      scenarioVersion = await createInitialScenarioVersion(context.token, simulator, context.user.id);
    }

    const incomingRevision = String(req.body.revision || "").trim();
    if (
      incomingRevision &&
      scenarioVersion.updated_at &&
      incomingRevision !== String(scenarioVersion.updated_at)
    ) {
      return res.status(409).json({
        error: "Draft was changed in another session. Reload editor and retry.",
      });
    }

    const graph = sanitizeEditorGraph(req.body.graph);
    const metadata = ensureJsonObject(scenarioVersion.metadata_json)
      ? { ...scenarioVersion.metadata_json }
      : {};
    metadata.editor_graph = graph;

    const startNode = graph.nodes.find((node) => node.type === "start");

    const updatedRows = await supabaseRest(
      `/scenario_versions?id=eq.${encodeURIComponent(scenarioVersion.id)}`,
      {
        method: "PATCH",
        token: context.token,
        prefer: "return=representation",
        body: {
          metadata_json: metadata,
          start_step_key: startNode?.id || "node_start",
        },
      }
    );

    const updated = updatedRows[0] || scenarioVersion;

    return res.status(200).json({
      dialogId: simulator.id,
      dialogName: simulator.name,
      scenarioVersionId: updated.id,
      scenarioState: updated.state || scenarioVersion.state,
      revision: updated.updated_at || null,
      graph,
    });
  } catch (error) {
    const payload = formatErrorPayload(error, "Unable to save editor graph.");
    return res.status(error.status || 500).json(payload);
  }
});

app.post("/api/v1/builder/dialogs/:id/duplicate", async (req, res) => {
  const context = await requireUserContext(req, res);
  if (!context) {
    return;
  }

  const simulatorId = String(req.params.id || "").trim();

  try {
    const sourceSimulator = await getSimulatorById(context.token, simulatorId);
    if (!sourceSimulator) {
      return res.status(404).json({ error: "Dialog not found." });
    }

    const membership = await getMembershipForWorkspace(
      context.token,
      context.user.id,
      sourceSimulator.workspace_id
    );

    if (!membership || (membership.role !== "owner" && membership.role !== "editor")) {
      return res.status(403).json({ error: "No permission to duplicate this dialog." });
    }

    const duplicateName = sanitizeDialogName(`${sourceSimulator.name} (copy)`);

    const insertedSimulators = await supabaseRest("/simulators", {
      method: "POST",
      token: context.token,
      prefer: "return=representation",
      body: {
        workspace_id: sourceSimulator.workspace_id,
        name: duplicateName,
        description: sourceSimulator.description,
        status: "draft",
        created_by: context.user.id,
      },
    });

    const duplicatedSimulator = insertedSimulators[0];

    const sourceVersions = await supabaseRest(
      `/scenario_versions?select=id,version_number,schema_version,title,locale,start_step_key,metadata_json&simulator_id=eq.${encodeURIComponent(sourceSimulator.id)}&order=version_number.desc&limit=1`,
      { token: context.token }
    );

    if (!sourceVersions[0]) {
      await supabaseRest("/scenario_versions", {
        method: "POST",
        token: context.token,
        prefer: "return=minimal",
        body: {
          simulator_id: duplicatedSimulator.id,
          version_number: 1,
          state: "draft",
          schema_version: "1.0.0",
          title: duplicateName,
          locale: "ru-RU",
          start_step_key: "node_start",
          metadata_json: { editor_graph: buildDefaultEditorGraph() },
          created_by: context.user.id,
        },
      });

      return res.status(201).json({ item: mapDialog(duplicatedSimulator, null) });
    }

    const sourceVersion = sourceVersions[0];

    const insertedVersions = await supabaseRest("/scenario_versions", {
      method: "POST",
      token: context.token,
      prefer: "return=representation",
      body: {
        simulator_id: duplicatedSimulator.id,
        version_number: 1,
        state: "draft",
        schema_version: sourceVersion.schema_version || "1.0.0",
        title: sourceVersion.title || duplicateName,
        locale: sourceVersion.locale || "ru-RU",
        start_step_key: sourceVersion.start_step_key || null,
        metadata_json: sourceVersion.metadata_json || {},
        created_by: context.user.id,
      },
    });

    const duplicatedVersion = insertedVersions[0];

    await copyScenarioRows(context.token, sourceVersion.id, duplicatedVersion.id);

    return res.status(201).json({ item: mapDialog(duplicatedSimulator, null) });
  } catch (error) {
    const payload = formatErrorPayload(error, "Unable to duplicate dialog.");
    return res.status(error.status || 500).json(payload);
  }
});

app.post("/api/v1/builder/dialogs/:id/publish", async (req, res) => {
  const context = await requireUserContext(req, res);
  if (!context) {
    return;
  }

  const simulatorId = String(req.params.id || "").trim();

  try {
    const simulator = await getSimulatorById(context.token, simulatorId);
    if (!simulator) {
      return res.status(404).json({ error: "Dialog not found." });
    }

    const membership = await getMembershipForWorkspace(
      context.token,
      context.user.id,
      simulator.workspace_id
    );

    if (!membership || (membership.role !== "owner" && membership.role !== "editor")) {
      return res.status(403).json({ error: "No permission to publish this dialog." });
    }

    let latestVersion = (
      await supabaseRest(
        `/scenario_versions?select=id,version_number,state,schema_version,title,locale,start_step_key,metadata_json&simulator_id=eq.${encodeURIComponent(simulator.id)}&order=version_number.desc&limit=1`,
        { token: context.token }
      )
    )[0];

    if (!latestVersion) {
      latestVersion = (
        await supabaseRest("/scenario_versions", {
          method: "POST",
          token: context.token,
          prefer: "return=representation",
          body: {
            simulator_id: simulator.id,
            version_number: 1,
            state: "draft",
            schema_version: "1.0.0",
            title: simulator.name,
            locale: "ru-RU",
            start_step_key: "node_start",
            metadata_json: { editor_graph: buildDefaultEditorGraph() },
            created_by: context.user.id,
          },
        })
      )[0];
    }

    if (latestVersion.state !== "published") {
      latestVersion = (
        await supabaseRest(`/scenario_versions?id=eq.${encodeURIComponent(latestVersion.id)}`, {
          method: "PATCH",
          token: context.token,
          prefer: "return=representation",
          body: {
            state: "published",
            published_at: new Date().toISOString(),
          },
        })
      )[0];
    }

    const existingPublication = (
      await supabaseRest(
        `/publications?select=id,publication_key,simulator_id,scenario_version_id,is_active,published_at&scenario_version_id=eq.${encodeURIComponent(latestVersion.id)}&limit=1`,
        { token: context.token }
      )
    )[0];

    const publicationKey =
      existingPublication?.publication_key ||
      crypto.randomUUID().replace(/-/g, "").slice(0, 16);

    const snapshotJson = {
      simulatorId: simulator.id,
      scenarioVersionId: latestVersion.id,
      schemaVersion: latestVersion.schema_version || "1.0.0",
      publishedAt: new Date().toISOString(),
    };

    let publication = null;

    if (existingPublication) {
      publication = (
        await supabaseRest(`/publications?id=eq.${encodeURIComponent(existingPublication.id)}`, {
          method: "PATCH",
          token: context.token,
          prefer: "return=representation",
          body: {
            is_active: true,
            snapshot_json: snapshotJson,
            published_by: context.user.id,
            published_at: new Date().toISOString(),
          },
        })
      )[0];
    } else {
      publication = (
        await supabaseRest("/publications", {
          method: "POST",
          token: context.token,
          prefer: "return=representation",
          body: {
            simulator_id: simulator.id,
            scenario_version_id: latestVersion.id,
            publication_key: publicationKey,
            snapshot_json: snapshotJson,
            is_active: true,
            published_by: context.user.id,
            published_at: new Date().toISOString(),
          },
        })
      )[0];
    }

    await supabaseRest(
      `/publications?simulator_id=eq.${encodeURIComponent(simulator.id)}&id=neq.${encodeURIComponent(publication.id)}`,
      {
        method: "PATCH",
        token: context.token,
        prefer: "return=minimal",
        body: { is_active: false },
      }
    );

    await supabaseRest(`/simulators?id=eq.${encodeURIComponent(simulator.id)}`, {
      method: "PATCH",
      token: context.token,
      prefer: "return=minimal",
      body: { status: "published" },
    });

    await supabaseRest("/export_artifacts?on_conflict=publication_id,type", {
      method: "POST",
      token: context.token,
      prefer: "resolution=merge-duplicates,return=minimal",
      body: buildExportArtifacts(publication.id, publication.publication_key),
    });

    return res.status(200).json({
      simulatorId: simulator.id,
      publicationId: publication.id,
      publicationKey: publication.publication_key,
      publishedAt: publication.published_at,
    });
  } catch (error) {
    const payload = formatErrorPayload(error, "Unable to publish dialog.");
    return res.status(error.status || 500).json(payload);
  }
});

app.post("/api/v1/builder/dialogs/:id/unpublish", async (req, res) => {
  const context = await requireUserContext(req, res);
  if (!context) {
    return;
  }

  const simulatorId = String(req.params.id || "").trim();

  try {
    const simulator = await getSimulatorById(context.token, simulatorId);
    if (!simulator) {
      return res.status(404).json({ error: "Dialog not found." });
    }

    const membership = await getMembershipForWorkspace(
      context.token,
      context.user.id,
      simulator.workspace_id
    );

    if (!membership || (membership.role !== "owner" && membership.role !== "editor")) {
      return res.status(403).json({ error: "No permission to unpublish this dialog." });
    }

    await supabaseRest(`/publications?simulator_id=eq.${encodeURIComponent(simulator.id)}`, {
      method: "PATCH",
      token: context.token,
      prefer: "return=minimal",
      body: { is_active: false },
    });

    await supabaseRest(`/simulators?id=eq.${encodeURIComponent(simulator.id)}`, {
      method: "PATCH",
      token: context.token,
      prefer: "return=minimal",
      body: { status: "draft" },
    });

    return res.status(200).json({ simulatorId: simulator.id, status: "draft" });
  } catch (error) {
    const payload = formatErrorPayload(error, "Unable to unpublish dialog.");
    return res.status(error.status || 500).json(payload);
  }
});

app.get("/api/v1/builder/dialogs/:id/export", async (req, res) => {
  const context = await requireUserContext(req, res);
  if (!context) {
    return;
  }

  const simulatorId = String(req.params.id || "").trim();

  try {
    const simulator = await getSimulatorById(context.token, simulatorId);
    if (!simulator) {
      return res.status(404).json({ error: "Dialog not found." });
    }

    const membership = await getMembershipForWorkspace(
      context.token,
      context.user.id,
      simulator.workspace_id
    );

    if (!membership) {
      return res.status(403).json({ error: "No access to this dialog." });
    }

    const publication = (
      await supabaseRest(
        `/publications?select=id,publication_key,published_at,is_active&simulator_id=eq.${encodeURIComponent(simulator.id)}&is_active=eq.true&order=published_at.desc&limit=1`,
        { token: context.token }
      )
    )[0];

    if (!publication) {
      return res.status(404).json({ error: "Dialog is not published yet." });
    }

    let artifacts = await supabaseRest(
      `/export_artifacts?select=type,url_or_snippet,content_hash&publication_id=eq.${encodeURIComponent(publication.id)}`,
      { token: context.token }
    );

    if (artifacts.length === 0) {
      const generated = buildExportArtifacts(publication.id, publication.publication_key);
      await supabaseRest("/export_artifacts", {
        method: "POST",
        token: context.token,
        prefer: "return=minimal",
        body: generated,
      });
      artifacts = generated;
    }

    const byType = new Map();
    artifacts.forEach((item) => byType.set(item.type, item.url_or_snippet));

    return res.status(200).json({
      publicationId: publication.id,
      publicationKey: publication.publication_key,
      publishedAt: publication.published_at,
      iframe: byType.get("iframe") || null,
      script: byType.get("script") || null,
      htmlUrl: byType.get("html") || null,
    });
  } catch (error) {
    const payload = formatErrorPayload(error, "Unable to get export info.");
    return res.status(error.status || 500).json(payload);
  }
});

app.post("/api/v1/builder/dialogs/:id/preview/link", async (req, res) => {
  const context = await requireUserContext(req, res);
  if (!context) {
    return;
  }

  const simulatorId = String(req.params.id || "").trim();

  try {
    const simulator = await getSimulatorById(context.token, simulatorId);
    if (!simulator) {
      return res.status(404).json({ error: "Dialog not found." });
    }

    const membership = await getMembershipForWorkspace(
      context.token,
      context.user.id,
      simulator.workspace_id
    );

    if (!membership) {
      return res.status(403).json({ error: "No access to this dialog." });
    }

    let scenarioVersion = await getLatestScenarioVersion(context.token, simulator.id);
    if (!scenarioVersion) {
      if (membership.role !== "owner" && membership.role !== "editor") {
        return res.status(404).json({ error: "No scenario draft found." });
      }
      scenarioVersion = await createInitialScenarioVersion(context.token, simulator, context.user.id);
    }

    const graph = sanitizeEditorGraph(scenarioVersion?.metadata_json?.editor_graph || null);
    const sceneType = sanitizeSceneType(scenarioVersion?.metadata_json?.scene_type);
    const assetCatalog = await buildPreviewAssetCatalog(context.token, graph);

    cleanupExpiredTempPreviewSessions();

    const previewToken = createTempPreviewToken();
    const nowMs = Date.now();
    const ttlMs = Math.max(60, Math.min(7200, TEMP_PREVIEW_TTL_SEC)) * 1000;
    const expiresAtMs = nowMs + ttlMs;

    tempPreviewSessions.set(previewToken, {
      token: previewToken,
      simulatorId: simulator.id,
      dialogName: simulator.name,
      sceneType,
      graph,
      assetCatalog,
      createdAtMs: nowMs,
      expiresAtMs,
    });

    const previewPath = `/preview/${previewToken}`;
    const baseUrl = `${req.protocol}://${req.get("host") || `localhost:${port}`}`;

    return res.status(201).json({
      token: previewToken,
      previewPath,
      previewUrl: `${baseUrl}${previewPath}`,
      expiresAt: new Date(expiresAtMs).toISOString(),
      ttlSec: Math.trunc(ttlMs / 1000),
      sceneType,
    });
  } catch (error) {
    const payload = formatErrorPayload(error, "Unable to create preview link.");
    return res.status(error.status || 500).json(payload);
  }
});

app.get("/api/v1/preview/:token", (req, res) => {
  cleanupExpiredTempPreviewSessions();

  const token = String(req.params.token || "").trim();
  if (!token) {
    return res.status(400).json({ error: "Invalid preview token." });
  }

  const session = tempPreviewSessions.get(token);
  if (!session) {
    return res.status(404).json({ error: "Preview link not found or expired." });
  }

  const nowMs = Date.now();
  if (Number(session.expiresAtMs || 0) <= nowMs) {
    tempPreviewSessions.delete(token);
    return res.status(410).json({ error: "Preview link has expired." });
  }

  return res.status(200).json({
    token,
    dialogId: session.simulatorId,
    dialogName: session.dialogName,
    sceneType: sanitizeSceneType(session.sceneType),
    graph: sanitizeEditorGraph(session.graph),
    assetCatalog: ensurePlainObject(session.assetCatalog)
      ? {
          character: Array.isArray(session.assetCatalog.character) ? session.assetCatalog.character : [],
          background: Array.isArray(session.assetCatalog.background) ? session.assetCatalog.background : [],
        }
      : { character: [], background: [] },
    expiresAt: new Date(Number(session.expiresAtMs || nowMs)).toISOString(),
    ttlSec: Math.max(0, Math.trunc((Number(session.expiresAtMs || nowMs) - nowMs) / 1000)),
  });
});

app.get("/api/v1/builder/dialogs/:id/preview/attempts/summary", async (req, res) => {
  const context = await requireUserContext(req, res);
  if (!context) {
    return;
  }

  const simulatorId = String(req.params.id || "").trim();

  try {
    const simulator = await getSimulatorById(context.token, simulatorId);
    if (!simulator) {
      return res.status(404).json({ error: "Dialog not found." });
    }

    const membership = await getMembershipForWorkspace(
      context.token,
      context.user.id,
      simulator.workspace_id
    );

    if (!membership) {
      return res.status(403).json({ error: "No access to this dialog." });
    }

    const publication = await getActivePublicationForSimulator(context.token, simulator.id);
    if (!publication) {
      return res.status(404).json({ error: "Dialog is not published yet." });
    }

    const maxAttempts = sanitizeOptionalInteger(req.query?.maxAttempts, 1, 1000);
    const learnerRef = String(context.user.id || "").trim() || null;

    const attemptRows = await supabaseRest(
      `/attempts?select=id&publication_id=eq.${encodeURIComponent(publication.id)}&learner_ref=eq.${encodeURIComponent(
        learnerRef
      )}&status=eq.completed`,
      { token: context.token }
    );

    const attemptsUsed = Array.isArray(attemptRows) ? attemptRows.length : 0;
    const attemptsRemaining =
      maxAttempts === null ? null : Math.max(0, Number(maxAttempts) - Number(attemptsUsed));

    return res.status(200).json({
      publicationId: publication.id,
      publicationKey: publication.publication_key,
      attemptsUsed,
      maxAttempts,
      attemptsRemaining,
    });
  } catch (error) {
    const payload = formatErrorPayload(error, "Unable to load attempts summary.");
    return res.status(error.status || 500).json(payload);
  }
});

app.post("/api/v1/builder/dialogs/:id/preview/attempts/complete", async (req, res) => {
  const context = await requireUserContext(req, res);
  if (!context) {
    return;
  }

  const simulatorId = String(req.params.id || "").trim();

  try {
    const simulator = await getSimulatorById(context.token, simulatorId);
    if (!simulator) {
      return res.status(404).json({ error: "Dialog not found." });
    }

    const membership = await getMembershipForWorkspace(
      context.token,
      context.user.id,
      simulator.workspace_id
    );

    if (!membership) {
      return res.status(403).json({ error: "No access to this dialog." });
    }

    const publication = await getActivePublicationForSimulator(context.token, simulator.id);
    if (!publication) {
      return res.status(404).json({ error: "Dialog is not published yet." });
    }

    const learnerRef = String(context.user.id || "").trim() || null;
    const maxAttempts = sanitizeOptionalInteger(req.body?.maxAttempts, 1, 1000);
    const passScore = sanitizeOptionalInteger(req.body?.passScore, 0, 100000);
    const finalScore = Math.trunc(clampNumber(req.body?.finalScore, -100000, 100000, 0));
    const passed = Boolean(req.body?.passed);

    const existingAttemptRows = await supabaseRest(
      `/attempts?select=id&publication_id=eq.${encodeURIComponent(publication.id)}&learner_ref=eq.${encodeURIComponent(
        learnerRef
      )}&status=eq.completed`,
      { token: context.token }
    );

    const attemptsUsedBefore = Array.isArray(existingAttemptRows) ? existingAttemptRows.length : 0;
    if (maxAttempts !== null && attemptsUsedBefore >= maxAttempts) {
      return res.status(409).json({
        error: "No attempts left.",
        attemptsUsed: attemptsUsedBefore,
        maxAttempts,
        attemptsRemaining: 0,
      });
    }

    const nowIso = new Date().toISOString();
    const runtimeContext = {
      source: "editor_preview",
      simulator_id: simulator.id,
      scene_type: "messenger",
      pass_score: passScore,
      max_attempts: maxAttempts,
      passed,
      final_score: finalScore,
    };

    const insertedAttempts = await supabaseRest("/attempts", {
      method: "POST",
      token: context.token,
      prefer: "return=representation",
      body: {
        publication_id: publication.id,
        learner_ref: learnerRef,
        status: "completed",
        started_at: nowIso,
        completed_at: nowIso,
        final_score: finalScore,
        ending_key: passed ? "pass" : "fail",
        runtime_context: runtimeContext,
      },
    });

    const attempt = insertedAttempts[0] || null;

    if (attempt?.id) {
      await supabaseRest("/attempt_events", {
        method: "POST",
        token: context.token,
        prefer: "return=minimal",
        body: {
          attempt_id: attempt.id,
          event_type: "preview_finished",
          payload_json: runtimeContext,
        },
      });
    }

    const attemptsUsed = attemptsUsedBefore + 1;
    const attemptsRemaining =
      maxAttempts === null ? null : Math.max(0, Number(maxAttempts) - Number(attemptsUsed));

    return res.status(200).json({
      attemptId: attempt?.id || null,
      attemptsUsed,
      maxAttempts,
      attemptsRemaining,
      finalScore,
      passed,
    });
  } catch (error) {
    const payload = formatErrorPayload(error, "Unable to complete preview attempt.");
    return res.status(error.status || 500).json(payload);
  }
});

app.delete("/api/v1/builder/dialogs/:id", async (req, res) => {
  const context = await requireUserContext(req, res);
  if (!context) {
    return;
  }

  const simulatorId = String(req.params.id || "").trim();

  try {
    const simulator = await getSimulatorById(context.token, simulatorId);
    if (!simulator) {
      return res.status(404).json({ error: "Dialog not found." });
    }

    const membership = await getMembershipForWorkspace(
      context.token,
      context.user.id,
      simulator.workspace_id
    );

    if (!membership || (membership.role !== "owner" && membership.role !== "editor")) {
      return res.status(403).json({ error: "No permission to delete this dialog." });
    }

    await supabaseRest(`/simulators?id=eq.${encodeURIComponent(simulator.id)}`, {
      method: "DELETE",
      token: context.token,
      prefer: "return=minimal",
    });

    return res.status(204).send();
  } catch (error) {
    const payload = formatErrorPayload(error, "Unable to delete dialog.");
    return res.status(error.status || 500).json(payload);
  }
});

app.get("/register", (_req, res) => {
  res.sendFile(path.join(publicDir, "register", "index.html"));
});

app.get("/login", (_req, res) => {
  res.sendFile(path.join(publicDir, "login", "index.html"));
});

app.get("/builder", (_req, res) => {
  res.sendFile(path.join(publicDir, "builder", "index.html"));
});

app.get("/assets", (_req, res) => {
  res.sendFile(path.join(publicDir, "assets", "index.html"));
});

app.get("/assets/characters/:id", (_req, res) => {
  res.sendFile(path.join(publicDir, "assets", "character-edit.html"));
});

app.get("/builder/dialog/:id", (_req, res) => {
  res.sendFile(path.join(publicDir, "builder", "editor", "index.html"));
});

app.get("/preview/:token", (_req, res) => {
  res.sendFile(path.join(publicDir, "preview", "index.html"));
});

app.get("/", (_req, res) => {
  res.redirect(302, "/register");
});

app.use((_req, res) => {
  res.status(404).json({ error: "Not found." });
});

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Server started at http://localhost:${port}`);
});
