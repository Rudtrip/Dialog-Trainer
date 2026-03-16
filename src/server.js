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
const CANONICAL_HOST = String(process.env.CANONICAL_HOST || "www.rudtrip.ru")
  .trim()
  .toLowerCase();
const CANONICAL_REDIRECT_HOSTS = new Set(
  String(process.env.CANONICAL_REDIRECT_HOSTS || "rudtrip.ru")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
);

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
const SUPABASE_SERVICE_ROLE_KEY = readOptionalEnv("SUPABASE_SERVICE_ROLE_KEY");
const ADMIN_EMAILS = new Set(
  String(process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
);
const PLAYER_BASE_URL = String(process.env.PLAYER_BASE_URL || "").trim();
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
const OPENAI_API_KEY = readOptionalEnv("OPENAI_API_KEY");
const OPENAI_MODEL = String(process.env.OPENAI_MODEL || "gpt-4o-mini").trim() || "gpt-4o-mini";
const ADMIN_USERS_MAX_PAGE_SIZE = 100;
const ADMIN_TARIFF_VALUES = new Set(["free", "pro", "enterprise"]);
const DEFAULT_TARIFF_PLANS = [
  {
    key: "free",
    title: "Starter",
    monthlyPrice: 0,
    yearlyPrice: 0,
    simulatorLimit: 2,
    supportLabel: "Базовая поддержка",
    features: ["2 симулятора", "Ручная публикация"],
    isActive: true,
    sortOrder: 10,
  },
  {
    key: "pro",
    title: "Pro Educator",
    monthlyPrice: 29,
    yearlyPrice: 24,
    simulatorLimit: 10,
    supportLabel: "Приоритетная поддержка",
    features: ["10 симуляторов", "Генерация диалогов через ИИ"],
    isActive: true,
    sortOrder: 20,
  },
  {
    key: "enterprise",
    title: "Institution",
    monthlyPrice: 99,
    yearlyPrice: 79,
    simulatorLimit: null,
    supportLabel: "Выделенный менеджер",
    features: ["Безлимитные симуляторы", "Персональный менеджер"],
    isActive: true,
    sortOrder: 30,
  },
];
const PREINSTALLED_MANAGER_EMAILS = new Set(
  String(process.env.PREINSTALLED_MANAGER_EMAILS || "salekh@reezonly.ru")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
);

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
app.use((req, res, next) => {
  const hostHeader = String(req.headers.host || "").trim().toLowerCase();
  if (!hostHeader || !CANONICAL_HOST) {
    next();
    return;
  }

  const hostWithoutPort = hostHeader.split(":")[0];
  if (
    !hostWithoutPort ||
    hostWithoutPort === CANONICAL_HOST ||
    !CANONICAL_REDIRECT_HOSTS.has(hostWithoutPort)
  ) {
    next();
    return;
  }

  const targetUrl = `https://${CANONICAL_HOST}${req.originalUrl || "/"}`;
  res.redirect(301, targetUrl);
});

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

async function mapLibraryAsset(assetRow, options) {
  const canManagePreinstalled = Boolean(
    options?.canManagePreinstalled || options?.canDeletePreinstalled
  );
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
    canDelete:
      assetRow.source === "user_upload" ||
      (canManagePreinstalled && assetRow.source === "preinstalled"),
    canEdit:
      assetRow.source === "user_upload" ||
      (canManagePreinstalled && assetRow.source === "preinstalled"),
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

function getUserEmailLower(user) {
  return String(user?.email || "").trim().toLowerCase();
}

function isAdminUser(user) {
  const email = getUserEmailLower(user);
  if (!email) {
    return false;
  }
  return ADMIN_EMAILS.has(email);
}

function isPreinstalledAssetManager(user) {
  const email = getUserEmailLower(user);
  if (!email) {
    return false;
  }
  return PREINSTALLED_MANAGER_EMAILS.has(email);
}

async function requireAdminContext(req, res) {
  const context = await requireUserContext(req, res);
  if (!context) {
    return null;
  }

  if (!SUPABASE_SERVICE_ROLE_KEY) {
    res.status(500).json({
      error: "Admin API is not configured. Missing SUPABASE_SERVICE_ROLE_KEY.",
    });
    return null;
  }

  if (ADMIN_EMAILS.size === 0) {
    res.status(500).json({
      error: "Admin API is not configured. Missing ADMIN_EMAILS.",
    });
    return null;
  }

  if (!isAdminUser(context.user)) {
    res.status(403).json({
      error: "Admin access denied.",
    });
    return null;
  }

  return context;
}

async function supabaseAuthAdmin(pathname, options) {
  const method = options?.method || "GET";
  const body = options?.body;
  const prefer = options?.prefer;

  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  if (prefer) {
    headers.Prefer = prefer;
  }

  const response = await fetch(`${SUPABASE_URL.replace(/\/+$/, "")}/auth/v1/admin${pathname}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const data = await fetchJsonSafe(response);

  if (!response.ok) {
    const error = new Error(data?.message || "Supabase auth admin request failed.");
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

function normalizeAdminUserPlan(user) {
  const candidates = [
    user?.user_metadata?.tariff,
    user?.user_metadata?.plan,
    user?.app_metadata?.tariff,
    user?.app_metadata?.plan,
  ];

  for (const rawValue of candidates) {
    const normalized = String(rawValue || "").trim().toLowerCase();
    if (normalized) {
      return normalized;
    }
  }

  return "free";
}

function normalizeAdminUserStatus(user) {
  const bannedUntil = String(user?.banned_until || "").trim();
  if (bannedUntil) {
    return "blocked";
  }

  if (user?.deleted_at) {
    return "inactive";
  }

  if (user?.email_confirmed_at) {
    return "active";
  }

  return "pending";
}

function mapAdminUser(user) {
  return {
    id: String(user?.id || ""),
    email: String(user?.email || ""),
    fullName: String(user?.user_metadata?.full_name || user?.user_metadata?.name || "").trim(),
    registeredAt: user?.created_at || null,
    emailConfirmedAt: user?.email_confirmed_at || null,
    lastSignInAt: user?.last_sign_in_at || null,
    plan: normalizeAdminUserPlan(user),
    status: normalizeAdminUserStatus(user),
  };
}

function sanitizeAdminUserId(value) {
  const normalized = String(value || "").trim();
  return /^[0-9a-fA-F-]{36}$/.test(normalized) ? normalized : null;
}

function sanitizeAdminTariff(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return ADMIN_TARIFF_VALUES.has(normalized) ? normalized : null;
}

function cloneDefaultTariffPlans() {
  return DEFAULT_TARIFF_PLANS.map((plan) => ({
    ...plan,
    features: Array.isArray(plan.features) ? plan.features.slice() : [],
  }));
}

function getDefaultTariffPlanByKey(key) {
  const normalized = sanitizeAdminTariff(key);
  if (!normalized) {
    return null;
  }
  return cloneDefaultTariffPlans().find((plan) => plan.key === normalized) || null;
}

function sanitizeTariffFeatureList(rawFeatures, fallbackFeatures) {
  const list = Array.isArray(rawFeatures)
    ? rawFeatures
    : typeof rawFeatures === "string"
      ? rawFeatures.split(/\r?\n/g)
      : [];

  const normalized = list
    .map((value) => String(value || "").trim().slice(0, 160))
    .filter(Boolean)
    .slice(0, 12);

  if (normalized.length > 0) {
    return normalized;
  }

  const fallback = Array.isArray(fallbackFeatures)
    ? fallbackFeatures.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  return fallback;
}

function mapTariffPlanRow(row, fallbackPlan) {
  const fallback = fallbackPlan || getDefaultTariffPlanByKey(row?.plan_key) || {
    key: "free",
    title: "Starter",
    monthlyPrice: 0,
    yearlyPrice: 0,
    simulatorLimit: 2,
    supportLabel: "Базовая поддержка",
    features: ["2 симулятора"],
    isActive: true,
    sortOrder: 0,
  };

  const key = sanitizeAdminTariff(row?.plan_key) || fallback.key;
  const title = String(row?.title || "").trim().slice(0, 120) || fallback.title;

  const monthlyRaw = Number(row?.monthly_price_usd);
  const yearlyRaw = Number(row?.yearly_price_usd);
  const monthlyPrice = Number.isFinite(monthlyRaw) && monthlyRaw >= 0 ? monthlyRaw : fallback.monthlyPrice;
  const yearlyPrice = Number.isFinite(yearlyRaw) && yearlyRaw >= 0 ? yearlyRaw : fallback.yearlyPrice;

  const limitRaw = row?.simulator_limit;
  const simulatorLimit =
    limitRaw === null || limitRaw === undefined || limitRaw === ""
      ? null
      : Number.isInteger(Number(limitRaw)) && Number(limitRaw) > 0
        ? Number(limitRaw)
        : fallback.simulatorLimit;

  const supportLabel =
    String(row?.support_label || "")
      .trim()
      .slice(0, 160) || fallback.supportLabel;
  const features = sanitizeTariffFeatureList(row?.features_json, fallback.features);

  const sortRaw = Number(row?.sort_order);
  const sortOrder = Number.isFinite(sortRaw) ? Math.trunc(sortRaw) : fallback.sortOrder;
  const isActive = typeof row?.is_active === "boolean" ? row.is_active : fallback.isActive;

  return {
    key,
    title,
    monthlyPrice,
    yearlyPrice,
    simulatorLimit,
    supportLabel,
    features,
    isActive,
    sortOrder,
  };
}

function isTariffTableMissingError(error) {
  const message = String(
    error?.data?.message ||
      error?.data?.error ||
      error?.data?.details ||
      error?.message ||
      ""
  ).toLowerCase();

  return (
    message.includes("tariff_plans") &&
    (message.includes("does not exist") ||
      message.includes("relation") ||
      message.includes("not found"))
  );
}

async function listTariffPlans(token) {
  const defaults = cloneDefaultTariffPlans();
  try {
    const rows = await supabaseRest(
      "/tariff_plans?select=plan_key,title,monthly_price_usd,yearly_price_usd,simulator_limit,support_label,features_json,is_active,sort_order&order=sort_order.asc&order=plan_key.asc",
      { token }
    );

    if (!Array.isArray(rows) || rows.length === 0) {
      return defaults;
    }

    const byKey = new Map(defaults.map((plan) => [plan.key, plan]));
    rows.forEach((row) => {
      const key = sanitizeAdminTariff(row?.plan_key);
      if (!key) {
        return;
      }
      byKey.set(key, mapTariffPlanRow(row, byKey.get(key)));
    });

    return Array.from(byKey.values()).sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) {
        return a.sortOrder - b.sortOrder;
      }
      return a.key.localeCompare(b.key);
    });
  } catch (error) {
    if (isTariffTableMissingError(error)) {
      return defaults;
    }
    throw error;
  }
}

function sanitizeTariffPlanPayload(payload, planKey) {
  if (!ensureJsonObject(payload)) {
    return { error: "Request body must be a JSON object." };
  }

  const key = sanitizeAdminTariff(planKey);
  if (!key) {
    return { error: "Invalid tariff key." };
  }

  const fallback = getDefaultTariffPlanByKey(key);

  const title = String(payload.title || "").trim().slice(0, 120);
  if (!title) {
    return { error: "Title is required." };
  }

  const monthlyPrice = Number(payload.monthlyPrice ?? payload.monthly_price_usd);
  if (!Number.isFinite(monthlyPrice) || monthlyPrice < 0 || monthlyPrice > 100000) {
    return { error: "Invalid monthly price." };
  }

  const yearlyPrice = Number(payload.yearlyPrice ?? payload.yearly_price_usd);
  if (!Number.isFinite(yearlyPrice) || yearlyPrice < 0 || yearlyPrice > 100000) {
    return { error: "Invalid yearly price." };
  }

  const simulatorLimitRaw = payload.simulatorLimit ?? payload.simulator_limit;
  let simulatorLimit = null;
  if (simulatorLimitRaw !== null && simulatorLimitRaw !== undefined && String(simulatorLimitRaw).trim() !== "") {
    const parsed = Number(simulatorLimitRaw);
    if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 1000000) {
      return { error: "Invalid simulator limit." };
    }
    simulatorLimit = parsed;
  }

  const supportLabel = String(payload.supportLabel ?? payload.support_label ?? "")
    .trim()
    .slice(0, 160);
  if (!supportLabel) {
    return { error: "Support label is required." };
  }

  const features = sanitizeTariffFeatureList(payload.features, fallback?.features || []);
  if (features.length === 0) {
    return { error: "At least one feature is required." };
  }

  const isActiveRaw =
    payload.isActive !== undefined
      ? payload.isActive
      : payload.is_active !== undefined
        ? payload.is_active
        : true;
  const isActive = Boolean(isActiveRaw);
  const sortOrderRaw = payload.sortOrder ?? payload.sort_order ?? fallback?.sortOrder ?? 0;
  const sortOrder = Number.isFinite(Number(sortOrderRaw)) ? Math.trunc(Number(sortOrderRaw)) : 0;

  return {
    value: {
      plan_key: key,
      title,
      monthly_price_usd: monthlyPrice,
      yearly_price_usd: yearlyPrice,
      simulator_limit: simulatorLimit,
      support_label: supportLabel,
      features_json: features,
      is_active: isActive,
      sort_order: sortOrder,
    },
  };
}

function getGenerateLinkFromPayload(payload) {
  if (!ensurePlainObject(payload)) {
    return "";
  }

  const direct = String(payload.action_link || "").trim();
  if (direct) {
    return direct;
  }

  const fromProperties = String(payload?.properties?.action_link || "").trim();
  if (fromProperties) {
    return fromProperties;
  }

  const fromData = String(payload?.data?.properties?.action_link || "").trim();
  if (fromData) {
    return fromData;
  }

  return "";
}

async function getAdminUserById(userId) {
  const payload = await supabaseAuthAdmin(`/users/${encodeURIComponent(userId)}`, {
    method: "GET",
  });

  if (ensurePlainObject(payload?.user)) {
    return payload.user;
  }

  if (ensurePlainObject(payload)) {
    return payload;
  }

  return null;
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

async function supabasePublicRest(pathname, options) {
  const method = options?.method || "GET";
  const body = options?.body;
  const prefer = options?.prefer;

  const headers = {
    apikey: SUPABASE_PUBLISHABLE_KEY,
  };

  if (SUPABASE_SERVICE_ROLE_KEY) {
    headers.Authorization = `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`;
  }

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
    const error = new Error(data?.message || "Supabase public REST request failed.");
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

function normalizeTariffSimulatorLimit(value) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function getEffectiveUserTariffKey(user) {
  const normalized = sanitizeAdminTariff(normalizeAdminUserPlan(user));
  return normalized || "free";
}

async function resolveUserTariffPlan(token, user) {
  const tariffKey = getEffectiveUserTariffKey(user);
  const plans = await listTariffPlans(token);
  const matched = Array.isArray(plans) ? plans.find((item) => item.key === tariffKey) : null;
  return matched || getDefaultTariffPlanByKey(tariffKey) || getDefaultTariffPlanByKey("free");
}

async function enforceUserSimulatorLimit(token, user) {
  const plan = await resolveUserTariffPlan(token, user);
  const simulatorLimit = normalizeTariffSimulatorLimit(plan?.simulatorLimit);
  if (simulatorLimit === null) {
    return {
      plan,
      simulatorLimit: null,
      simulatorsUsed: null,
    };
  }

  const rows = await supabaseRest(
    `/simulators?select=id&created_by=eq.${encodeURIComponent(user.id)}&status=neq.archived&order=created_at.asc&limit=${simulatorLimit}`,
    { token }
  );

  const simulatorsUsed = Array.isArray(rows) ? rows.length : 0;
  if (simulatorsUsed >= simulatorLimit) {
    const planTitle = String(plan?.title || "Free").trim();
    const error = new Error(
      `Ваш тариф «${planTitle}» позволяет создать не более ${simulatorLimit} тренажеров. Измените тариф или удалите существующий тренажер.`
    );
    error.status = 409;
    error.data = {
      code: "simulator_limit_reached",
      tariff: plan?.key || "free",
      tariffTitle: planTitle,
      simulatorLimit,
      simulatorsUsed,
    };
    throw error;
  }

  return {
    plan,
    simulatorLimit,
    simulatorsUsed,
  };
}

function hasAiGenerationAccess(plan) {
  const key = String(plan?.key || "")
    .trim()
    .toLowerCase();

  if (
    key === "pro" ||
    key === "enterprise" ||
    key === "proeducator52" ||
    key === "pro_educator52" ||
    key === "pro-educator52"
  ) {
    return true;
  }

  const title = String(plan?.title || "")
    .trim()
    .toLowerCase();
  if (!title) {
    return false;
  }

  return title.includes("pro educator52") || title.includes("institution");
}

function clampInteger(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  const normalized = Math.trunc(parsed);
  return Math.max(min, Math.min(max, normalized));
}

function sanitizeAiScenarioDescription(value) {
  const normalized = String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 3000);
  return normalized || null;
}

function parseJsonObjectFromText(rawText) {
  const text = String(rawText || "").trim();
  if (!text) {
    return null;
  }

  try {
    const parsedDirect = JSON.parse(text);
    return ensureJsonObject(parsedDirect) ? parsedDirect : null;
  } catch (_error) {
    // fallback below
  }

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    return null;
  }

  const candidate = text.slice(firstBrace, lastBrace + 1);
  try {
    const parsedCandidate = JSON.parse(candidate);
    return ensureJsonObject(parsedCandidate) ? parsedCandidate : null;
  } catch (_error) {
    return null;
  }
}

function normalizeAiEmotion(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === "happy") return "happy";
  if (normalized === "concerned") return "concerned";
  if (normalized === "angry") return "angry";
  return "neutral";
}

function normalizeAiResponseFeedback(scoreDelta) {
  if (scoreDelta > 0) {
    return "positive";
  }
  if (scoreDelta < 0) {
    return "negative";
  }
  return "neutral";
}

function normalizeAiEndingTypeByScore(scoreDelta) {
  if (scoreDelta > 0) {
    return "success";
  }
  if (scoreDelta < 0) {
    return "fail";
  }
  return "neutral";
}

function normalizeAiRouteKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

function normalizeAiScenarioBlueprint(rawBlueprint) {
  const blueprint = ensureJsonObject(rawBlueprint) ? rawBlueprint : {};
  const speakerName = String(blueprint.speakerName || "Персонаж")
    .trim()
    .slice(0, 80) || "Персонаж";

  const inputMessages = Array.isArray(blueprint.messages) ? blueprint.messages.slice(0, 8) : [];
  const usedMessageIds = new Set();
  const resolveMessageId = (rawId, fallbackIndex) => {
    const fallback = `message_${fallbackIndex}`;
    const base = normalizeAiRouteKey(rawId) || fallback;
    let candidate = base;
    let suffix = 2;
    while (usedMessageIds.has(candidate)) {
      const nextCandidate = `${base}_${suffix++}`;
      candidate = normalizeAiRouteKey(nextCandidate).slice(0, 40) || fallback;
    }
    usedMessageIds.add(candidate);
    return candidate;
  };

  const messageDrafts = inputMessages
    .map((message, messageIndex) => {
      if (!ensureJsonObject(message)) {
        return null;
      }

      const text = String(message.text || "")
        .trim()
        .slice(0, 4000);
      if (!text) {
        return null;
      }

      return {
        id: resolveMessageId(message.id, messageIndex + 1),
        text,
        emotionState: normalizeAiEmotion(message.emotionState),
        inputResponses: Array.isArray(message.responses) ? message.responses.slice(0, 3) : [],
      };
    })
    .filter(Boolean);

  const messages = [];
  if (messageDrafts.length === 0) {
    messageDrafts.push({
      id: "message_1",
      text: "Добрый день. Опишите, пожалуйста, вашу ситуацию.",
      emotionState: "neutral",
      inputResponses: [
        {
          text: "Спокойно объяснить детали проблемы.",
          scoreDelta: 5,
          nextType: "ending",
          nextRef: "success",
        },
        {
          text: "Проигнорировать вопрос и сменить тему.",
          scoreDelta: -3,
          nextType: "ending",
          nextRef: "fail",
        },
      ],
    });
    usedMessageIds.add("message_1");
  }

  const messageIdSet = new Set(messageDrafts.map((item) => item.id));
  const endingTypes = new Set(["success", "neutral", "fail"]);

  messageDrafts.forEach((message, messageIndex) => {
    const inputResponses = Array.isArray(message.inputResponses)
      ? message.inputResponses.slice(0, 3)
      : [];

    const responses = inputResponses
      .map((response, responseIndex) => {
        if (!ensureJsonObject(response)) {
          return null;
        }
        const responseText = String(response.text || "")
          .trim()
          .slice(0, 4000);
        if (!responseText) {
          return null;
        }
        const scoreDelta = clampInteger(response.scoreDelta, -1000, 1000, 0);
        const nextType = String(response.nextType || "")
          .trim()
          .toLowerCase();
        const nextRef = String(
          response.nextRef ?? response.nextMessageId ?? response.nextMessage ?? response.endingType ?? ""
        )
          .trim()
          .toLowerCase();

        let nextMessageId = null;
        let endingType = null;
        if (nextType === "message") {
          const normalizedRef = normalizeAiRouteKey(nextRef);
          if (normalizedRef && normalizedRef !== message.id && messageIdSet.has(normalizedRef)) {
            nextMessageId = normalizedRef;
          }
        } else if (nextType === "ending") {
          if (endingTypes.has(nextRef)) {
            endingType = nextRef;
          }
        } else {
          // Backward compatibility for older prompt outputs.
          const normalizedRef = normalizeAiRouteKey(nextRef);
          if (endingTypes.has(nextRef)) {
            endingType = nextRef;
          } else if (normalizedRef && normalizedRef !== message.id && messageIdSet.has(normalizedRef)) {
            nextMessageId = normalizedRef;
          }
        }

        return {
          id: `response_${messageIndex + 1}_${responseIndex + 1}`,
          text: responseText,
          scoreDelta,
          feedbackType: normalizeAiResponseFeedback(scoreDelta),
          nextMessageId,
          endingType,
        };
      })
      .filter(Boolean);

    if (responses.length < 2) {
      responses.push(
        {
          id: `response_${messageIndex + 1}_fallback_1`,
          text: "Продолжить диалог в конструктивном тоне.",
          scoreDelta: 5,
          feedbackType: "positive",
          nextMessageId: null,
          endingType: null,
        },
        {
          id: `response_${messageIndex + 1}_fallback_2`,
          text: "Ответить резко и оборвать диалог.",
          scoreDelta: -5,
          feedbackType: "negative",
          nextMessageId: null,
          endingType: null,
        }
      );
    }

    const sequentialFallbackId = messageDrafts[messageIndex + 1]?.id || null;
    responses.slice(0, 3).forEach((response) => {
      if (!response.nextMessageId && !response.endingType) {
        if (sequentialFallbackId) {
          response.nextMessageId = sequentialFallbackId;
        } else {
          response.endingType = normalizeAiEndingTypeByScore(response.scoreDelta);
        }
      }
    });

    messages.push({
      id: message.id,
      text: message.text,
      emotionState: message.emotionState,
      responses: responses.slice(0, 3),
    });
  });

  // Enforce visible branching on the first NPC step if model merged all options into one path.
  if (messages.length > 2 && Array.isArray(messages[0]?.responses) && messages[0].responses.length > 1) {
    const firstResponses = messages[0].responses;
    const currentTargets = new Set(firstResponses.map((item) => item.nextMessageId).filter(Boolean));
    if (currentTargets.size <= 1) {
      const availableTargets = messages.slice(1).map((item) => item.id);
      firstResponses.forEach((response, index) => {
        const branchTarget = availableTargets[index] || availableTargets[availableTargets.length - 1] || null;
        if (branchTarget && branchTarget !== messages[0].id) {
          response.nextMessageId = branchTarget;
          response.endingType = null;
        }
      });
    }
  }

  const endingsRaw = ensureJsonObject(blueprint.endings) ? blueprint.endings : {};
  const normalizeEnding = (value, fallbackTitle, fallbackDescription) => {
    const item = ensureJsonObject(value) ? value : {};
    return {
      title:
        String(item.title || "")
          .trim()
          .slice(0, 120) || fallbackTitle,
      description:
        String(item.description || "")
          .trim()
          .slice(0, 1200) || fallbackDescription,
    };
  };

  const endings = {
    success: normalizeEnding(
      endingsRaw.success,
      "Успешное завершение",
      "Пользователь выбрал конструктивные ответы и успешно завершил сценарий."
    ),
    neutral: normalizeEnding(
      endingsRaw.neutral,
      "Нейтральное завершение",
      "Сценарий завершён без выраженного успеха или провала."
    ),
    fail: normalizeEnding(
      endingsRaw.fail,
      "Провал",
      "Сценарий завершён с ошибками в коммуникации."
    ),
  };

  return {
    speakerName,
    messages,
    endings,
  };
}

function buildEditorGraphFromAiBlueprint(blueprint) {
  const normalized = normalizeAiScenarioBlueprint(blueprint);
  const startNode = {
    id: "node_start",
    type: "start",
    position: { x: 620, y: 80 },
    data: {
      title: "Инициализация сценария",
      passScore: null,
      maxAttempts: null,
    },
  };

  const nodes = [startNode];
  const edges = [];
  const messageNodeIdByKey = new Map();

  const messageX = 640;
  const firstMessageY = 240;
  const messageGapY = 360;
  const responseYShift = 170;
  const responseGapX = 290;
  const messagePositions = new Map();

  const depthByMessage = new Map();
  const firstMessageKey = normalized.messages[0]?.id || null;
  if (firstMessageKey) {
    depthByMessage.set(firstMessageKey, 0);
    const queue = [firstMessageKey];
    let guard = 0;
    while (queue.length > 0 && guard < 500) {
      guard += 1;
      const currentKey = queue.shift();
      const currentDepth = Number(depthByMessage.get(currentKey));
      const currentMessage = normalized.messages.find((item) => item.id === currentKey);
      if (!currentMessage) {
        continue;
      }
      const responses = Array.isArray(currentMessage.responses) ? currentMessage.responses : [];
      responses.forEach((response) => {
        const nextKey = String(response?.nextMessageId || "").trim();
        if (!nextKey) {
          return;
        }
        const knownDepth = depthByMessage.get(nextKey);
        const candidateDepth = currentDepth + 1;
        if (!Number.isFinite(Number(knownDepth)) || candidateDepth < Number(knownDepth)) {
          depthByMessage.set(nextKey, candidateDepth);
          queue.push(nextKey);
        }
      });
    }
  }

  const groupsByDepth = new Map();
  normalized.messages.forEach((message, messageIndex) => {
    const fallbackDepth = messageIndex;
    const depth = Number.isFinite(Number(depthByMessage.get(message.id)))
      ? Number(depthByMessage.get(message.id))
      : fallbackDepth;
    const list = groupsByDepth.get(depth) || [];
    list.push(message.id);
    groupsByDepth.set(depth, list);
  });

  Array.from(groupsByDepth.entries())
    .sort((a, b) => a[0] - b[0])
    .forEach(([depth, messageKeys]) => {
      const startX = messageX - ((messageKeys.length - 1) * responseGapX) / 2;
      messageKeys.forEach((messageKey, index) => {
        messagePositions.set(messageKey, {
          x: Math.round(startX + index * responseGapX),
          y: firstMessageY + depth * messageGapY,
        });
      });
    });

  normalized.messages.forEach((message, messageIndex) => {
    const messageId = `node_message_ai_${normalizeAiRouteKey(message.id || messageIndex + 1) || messageIndex + 1}`;
    messageNodeIdByKey.set(message.id, messageId);
    const position = messagePositions.get(message.id) || {
      x: messageX,
      y: firstMessageY + messageIndex * messageGapY,
    };
    nodes.push({
      id: messageId,
      type: "message",
      position,
      data: {
        speakerType: "npc",
        speakerName: normalized.speakerName,
        text: message.text,
        characterAssetId: null,
        backgroundAssetId: null,
        emotionState: normalizeAiEmotion(message.emotionState),
        mediaRef: null,
      },
    });
  });

  if (firstMessageKey && messageNodeIdByKey.has(firstMessageKey)) {
    edges.push({
      id: "edge_start_to_first_message",
      source: startNode.id,
      target: messageNodeIdByKey.get(firstMessageKey),
    });
  }

  const messageMaxY = Array.from(messagePositions.values()).reduce(
    (maxValue, position) => Math.max(maxValue, Number(position?.y) || 0),
    firstMessageY
  );
  const endingY = messageMaxY + 360;
  const endingNodes = {
    success: {
      id: "node_end_success_ai",
      type: "end",
      position: { x: messageX - 340, y: endingY },
      data: {
        endingType: "success",
        title: normalized.endings.success.title,
        description: normalized.endings.success.description,
      },
    },
    neutral: {
      id: "node_end_neutral_ai",
      type: "end",
      position: { x: messageX, y: endingY + 20 },
      data: {
        endingType: "neutral",
        title: normalized.endings.neutral.title,
        description: normalized.endings.neutral.description,
      },
    },
    fail: {
      id: "node_end_fail_ai",
      type: "end",
      position: { x: messageX + 340, y: endingY },
      data: {
        endingType: "fail",
        title: normalized.endings.fail.title,
        description: normalized.endings.fail.description,
      },
    },
  };
  nodes.push(endingNodes.success, endingNodes.neutral, endingNodes.fail);

  normalized.messages.forEach((message, messageIndex) => {
    const sourceMessageId = messageNodeIdByKey.get(message.id);
    if (!sourceMessageId) {
      return;
    }
    const sourcePosition = messagePositions.get(message.id) || {
      x: messageX,
      y: firstMessageY + messageIndex * messageGapY,
    };
    const responses = Array.isArray(message.responses) ? message.responses : [];
    const responseStartX = sourcePosition.x - ((responses.length - 1) * responseGapX) / 2;

    responses.forEach((response, responseIndex) => {
      const responseId = `node_response_ai_${messageIndex + 1}_${responseIndex + 1}`;
      const scoreDelta = clampInteger(response.scoreDelta, -1000, 1000, 0);
      nodes.push({
        id: responseId,
        type: "response",
        position: {
          x: Math.round(responseStartX + responseIndex * responseGapX),
          y: sourcePosition.y + responseYShift,
        },
        data: {
          responseText: String(response.text || "").slice(0, 4000),
          scoreDelta,
          feedbackType: normalizeAiResponseFeedback(scoreDelta),
          hintEnabled: false,
          hintText: "",
          nextStepRef: null,
        },
      });

      edges.push({
        id: `edge_message_${messageIndex + 1}_response_${responseIndex + 1}`,
        source: sourceMessageId,
        target: responseId,
      });

      const routeNextMessageKey = String(response.nextMessageId || "").trim();
      const routeEndingType = String(response.endingType || "")
        .trim()
        .toLowerCase();
      const routedMessageNodeId = routeNextMessageKey
        ? messageNodeIdByKey.get(routeNextMessageKey) || null
        : null;

      if (routedMessageNodeId && routedMessageNodeId !== sourceMessageId) {
        edges.push({
          id: `edge_response_${messageIndex + 1}_${responseIndex + 1}_to_message_${normalizeAiRouteKey(routeNextMessageKey) || (messageIndex + 2)}`,
          source: responseId,
          target: routedMessageNodeId,
        });
      } else {
        const endingType =
          routeEndingType === "success" || routeEndingType === "neutral" || routeEndingType === "fail"
            ? routeEndingType
            : normalizeAiEndingTypeByScore(scoreDelta);
        const endingNode = endingNodes[endingType] || endingNodes.neutral;
        edges.push({
          id: `edge_response_${messageIndex + 1}_${responseIndex + 1}_to_end_${endingType}`,
          source: responseId,
          target: endingNode.id,
        });
      }
    });
  });

  return sanitizeEditorGraph({
    version: 1,
    viewport: { zoom: 100, x: 0, y: 0 },
    nodes,
    edges,
  });
}

async function requestAiScenarioBlueprint({ description, dialogName, sceneType }) {
  if (!OPENAI_API_KEY) {
    const error = new Error("AI generation is not configured. Missing OPENAI_API_KEY.");
    error.status = 500;
    throw error;
  }

  const systemPrompt = [
    "You are an expert instructional dialogue designer for a branching simulator builder.",
    "Create a practical training scenario with NPC messages and learner responses.",
    "Output MUST be valid JSON according to the provided schema.",
    "Write all text in Russian.",
    "Keep tone professional and safe for workplace training.",
    "Create true branching: each learner response must explicitly define routing via nextType and nextRef.",
    "Use nextType='message' with nextRef=<message.id> for branch continuation, or nextType='ending' with nextRef in [success, neutral, fail].",
    "The first NPC message must have 2-3 responses that lead to different next messages (no single shared follow-up for all options).",
    "Each message should include 2-3 response options with scoreDelta from -20 to 20.",
    "Do not include markdown or extra commentary.",
  ].join(" ");

  const userPrompt = [
    `Название тренажера: ${String(dialogName || "Сценарий").trim() || "Сценарий"}.`,
    `Тип сцены: ${String(sceneType || "messenger").trim().toLowerCase() === "dialog" ? "dialog" : "messenger"}.`,
    `Описание сценария: ${description}.`,
  ].join("\n");

  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["speakerName", "messages", "endings"],
    properties: {
      speakerName: {
        type: "string",
        minLength: 2,
        maxLength: 80,
      },
      messages: {
        type: "array",
        minItems: 3,
        maxItems: 8,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "text", "emotionState", "responses"],
          properties: {
            id: {
              type: "string",
              pattern: "^[a-z0-9_-]{2,40}$",
            },
            text: {
              type: "string",
              minLength: 12,
              maxLength: 700,
            },
            emotionState: {
              type: "string",
              enum: ["neutral", "happy", "concerned", "angry"],
            },
            responses: {
              type: "array",
              minItems: 2,
              maxItems: 3,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["text", "scoreDelta", "nextType", "nextRef"],
                properties: {
                  text: {
                    type: "string",
                    minLength: 6,
                    maxLength: 280,
                  },
                  scoreDelta: {
                    type: "integer",
                    minimum: -20,
                    maximum: 20,
                  },
                  nextType: {
                    type: "string",
                    enum: ["message", "ending"],
                  },
                  nextRef: {
                    type: "string",
                    minLength: 2,
                    maxLength: 40,
                  },
                },
              },
            },
          },
        },
      },
      endings: {
        type: "object",
        additionalProperties: false,
        required: ["success", "neutral", "fail"],
        properties: {
          success: {
            type: "object",
            additionalProperties: false,
            required: ["title", "description"],
            properties: {
              title: { type: "string", minLength: 2, maxLength: 120 },
              description: { type: "string", minLength: 8, maxLength: 500 },
            },
          },
          neutral: {
            type: "object",
            additionalProperties: false,
            required: ["title", "description"],
            properties: {
              title: { type: "string", minLength: 2, maxLength: 120 },
              description: { type: "string", minLength: 8, maxLength: 500 },
            },
          },
          fail: {
            type: "object",
            additionalProperties: false,
            required: ["title", "description"],
            properties: {
              title: { type: "string", minLength: 2, maxLength: 120 },
              description: { type: "string", minLength: 8, maxLength: 500 },
            },
          },
        },
      },
    },
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000);

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: userPrompt,
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "dialog_trainer_scenario_blueprint",
            schema,
            strict: true,
          },
        },
      }),
      signal: controller.signal,
    });

    const payload = await fetchJsonSafe(response);
    if (!response.ok) {
      const error = new Error(
        payload?.error?.message ||
          payload?.error?.code ||
          payload?.message ||
          "OpenAI request failed."
      );
      error.status = response.status;
      error.data = payload;
      throw error;
    }

    const content = String(payload?.choices?.[0]?.message?.content || "").trim();
    const parsed = parseJsonObjectFromText(content);
    if (!parsed) {
      const error = new Error("OpenAI returned invalid scenario JSON.");
      error.status = 502;
      error.data = payload;
      throw error;
    }

    return normalizeAiScenarioBlueprint(parsed);
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeoutError = new Error("AI generation timed out. Please try again.");
      timeoutError.status = 504;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
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

function normalizeBaseUrl(value) {
  return String(value || "")
    .trim()
    .replace(/\/+$/g, "");
}

function resolvePlayerBaseUrl(req) {
  const configured = normalizeBaseUrl(PLAYER_BASE_URL);
  if (configured && !/player\.dialog-trainer\.local/i.test(configured)) {
    return configured;
  }

  const forwardedProto = String(req?.headers?.["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim();
  const forwardedHost = String(req?.headers?.["x-forwarded-host"] || "")
    .split(",")[0]
    .trim();
  const host = forwardedHost || String(req?.headers?.host || "").trim();

  if (host) {
    const proto = forwardedProto || (req?.socket?.encrypted ? "https" : "http");
    return `${proto}://${host}`;
  }

  if (configured) {
    return configured;
  }

  return "http://localhost:3000";
}

function buildExportArtifacts(publicationId, publicationKey, playerBaseUrl) {
  const baseUrl = normalizeBaseUrl(playerBaseUrl) || "http://localhost:3000";
  const iframeSrc = `${baseUrl}/p/${publicationKey}`;
  const iframeSnippet = `<iframe src=\"${iframeSrc}\" width=\"100%\" height=\"720\" frameborder=\"0\" allowfullscreen></iframe>`;
  const scriptSnippet = `<script src=\"${baseUrl}/embed.js\" data-publication=\"${publicationKey}\"></script>`;
  const htmlUrl = `${baseUrl}/export/${publicationKey}.html`;

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

function buildRuntimePayload(input) {
  const graph = sanitizeEditorGraph(input?.graph || null);
  const sceneType = sanitizeSceneType(input?.sceneType);
  const assetCatalog = ensurePlainObject(input?.assetCatalog)
    ? {
        character: Array.isArray(input.assetCatalog.character) ? input.assetCatalog.character : [],
        background: Array.isArray(input.assetCatalog.background) ? input.assetCatalog.background : [],
      }
    : { character: [], background: [] };

  return {
    dialogId: input?.dialogId || null,
    dialogName: String(input?.dialogName || "Диалог").trim() || "Диалог",
    sceneType,
    graph,
    assetCatalog,
    publicationKey: input?.publicationKey || null,
    publishedAt: input?.publishedAt || null,
    source: input?.source || "publication",
  };
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
          tariff: "free",
          plan: "free",
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

app.post("/api/v1/auth/refresh", async (req, res) => {
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

  const refreshToken = String(req.body.refreshToken || req.body.refresh_token || "").trim();
  if (!refreshToken) {
    return res.status(400).json({
      error: "Refresh token is required.",
    });
  }

  const refreshUrl = `${SUPABASE_URL.replace(/\/+$/, "")}/auth/v1/token?grant_type=refresh_token`;

  try {
    const response = await fetch(refreshUrl, {
      method: "POST",
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        refresh_token: refreshToken,
      }),
    });

    const data = await fetchJsonSafe(response);

    if (!response.ok) {
      const message =
        data.msg ||
        data.error_description ||
        data.error ||
        "Supabase refresh failed.";

      return res.status(response.status).json({
        error: message,
      });
    }

    return res.status(200).json({
      session: data,
      accessToken: data.access_token || null,
      refreshToken: data.refresh_token || refreshToken || null,
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

app.patch("/api/v1/auth/me", async (req, res) => {
  const context = await requireUserContext(req, res);
  if (!context) {
    return;
  }

  if (!ensureJsonObject(req.body)) {
    return res.status(400).json({
      error: "Request body must be a JSON object.",
    });
  }

  const fullNameRaw = Object.prototype.hasOwnProperty.call(req.body, "fullName")
    ? req.body.fullName
    : req.body.full_name;
  const fullName = String(fullNameRaw || "").trim().slice(0, 120);

  if (fullName.length < 2) {
    return res.status(400).json({
      error: "Full name must contain at least 2 characters.",
    });
  }

  const currentMetadata = ensurePlainObject(context.user?.user_metadata)
    ? { ...context.user.user_metadata }
    : {};
  currentMetadata.full_name = fullName;

  try {
    const response = await fetch(`${SUPABASE_URL.replace(/\/+$/, "")}/auth/v1/user`, {
      method: "PUT",
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${context.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        data: currentMetadata,
      }),
    });

    const data = await fetchJsonSafe(response);

    if (!response.ok) {
      const error = new Error(data?.error_description || data?.error || "Unable to update profile.");
      error.status = response.status;
      error.data = data;
      throw error;
    }

    const user = ensurePlainObject(data?.user) ? data.user : data;
    return res.status(200).json({ user });
  } catch (error) {
    const payload = formatErrorPayload(error, "Unable to update profile.");
    return res.status(error.status || 500).json(payload);
  }
});

app.get("/api/v1/tariffs", async (req, res) => {
  const context = await requireUserContext(req, res);
  if (!context) {
    return;
  }

  try {
    const items = await listTariffPlans(context.token);
    const currentPlan = normalizeAdminUserPlan(context.user);

    return res.status(200).json({
      items,
      currentPlan,
    });
  } catch (error) {
    const payload = formatErrorPayload(error, "Unable to load tariff plans.");
    return res.status(error.status || 500).json(payload);
  }
});

app.get("/api/v1/admin/users", async (req, res) => {
  const context = await requireAdminContext(req, res);
  if (!context) {
    return;
  }

  try {
    const page = sanitizeOptionalInteger(req.query?.page, 1, 100000) || 1;
    const pageSize =
      sanitizeOptionalInteger(req.query?.pageSize, 1, ADMIN_USERS_MAX_PAGE_SIZE) || 20;
    const search = String(req.query?.search || "").trim().toLowerCase();

    const needClientFiltering = Boolean(search);
    const fetchPage = needClientFiltering ? 1 : page;
    const fetchPageSize = needClientFiltering ? ADMIN_USERS_MAX_PAGE_SIZE : pageSize;
    const query = new URLSearchParams({
      page: String(fetchPage),
      per_page: String(fetchPageSize),
    });

    const payload = await supabaseAuthAdmin(`/users?${query.toString()}`, {
      method: "GET",
    });

    const allUsers = Array.isArray(payload?.users) ? payload.users : [];

    let filtered = allUsers.map(mapAdminUser);
    if (search) {
      filtered = filtered.filter((user) => {
        const email = String(user.email || "").toLowerCase();
        const fullName = String(user.fullName || "").toLowerCase();
        return email.includes(search) || fullName.includes(search);
      });
    }

    const total =
      typeof payload?.total === "number"
        ? payload.total
        : search
          ? filtered.length
          : null;

    const start = search ? (page - 1) * pageSize : 0;
    const items = search ? filtered.slice(start, start + pageSize) : filtered;
    const hasNextPage =
      search
        ? start + pageSize < filtered.length
        : Boolean(payload?.next_page) || items.length >= pageSize;

    return res.status(200).json({
      page,
      pageSize,
      search,
      total,
      hasNextPage,
      items,
    });
  } catch (error) {
    const payload = formatErrorPayload(error, "Unable to load admin users.");
    return res.status(error.status || 500).json(payload);
  }
});

app.get("/api/v1/admin/tariffs", async (req, res) => {
  const context = await requireAdminContext(req, res);
  if (!context) {
    return;
  }

  try {
    const items = await listTariffPlans(context.token);
    return res.status(200).json({ items });
  } catch (error) {
    const payload = formatErrorPayload(error, "Unable to load tariff plans.");
    return res.status(error.status || 500).json(payload);
  }
});

app.put("/api/v1/admin/tariffs/:key", async (req, res) => {
  const context = await requireAdminContext(req, res);
  if (!context) {
    return;
  }

  const planKey = sanitizeAdminTariff(req.params?.key);
  if (!planKey) {
    return res.status(400).json({
      error: "Invalid tariff key. Allowed: free, pro, enterprise.",
    });
  }

  const sanitized = sanitizeTariffPlanPayload(req.body, planKey);
  if (!sanitized.value) {
    return res.status(400).json({
      error: sanitized.error || "Invalid tariff payload.",
    });
  }

  try {
    const rows = await supabasePublicRest("/tariff_plans?on_conflict=plan_key", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=representation",
      body: sanitized.value,
    });

    const row = Array.isArray(rows) ? rows[0] : rows;
    const item = mapTariffPlanRow(row, getDefaultTariffPlanByKey(planKey));

    return res.status(200).json({
      ok: true,
      item,
    });
  } catch (error) {
    if (isTariffTableMissingError(error)) {
      return res.status(500).json({
        error: "Tariff storage is not configured. Apply migration 007_create_tariff_plans.sql first.",
      });
    }
    const payload = formatErrorPayload(error, "Unable to save tariff plan.");
    return res.status(error.status || 500).json(payload);
  }
});

app.post("/api/v1/admin/users/:id/password", async (req, res) => {
  const context = await requireAdminContext(req, res);
  if (!context) {
    return;
  }

  const userId = sanitizeAdminUserId(req.params?.id);
  if (!userId) {
    return res.status(400).json({ error: "Invalid user id." });
  }

  const password = String(req.body?.password || "");
  if (password.length < 8 || password.length > 128) {
    return res.status(400).json({
      error: "Password must contain 8-128 characters.",
    });
  }

  try {
    await supabaseAuthAdmin(`/users/${encodeURIComponent(userId)}`, {
      method: "PUT",
      body: {
        password,
      },
    });

    return res.status(200).json({
      ok: true,
      userId,
    });
  } catch (error) {
    const payload = formatErrorPayload(error, "Unable to change user password.");
    return res.status(error.status || 500).json(payload);
  }
});

app.post("/api/v1/admin/users/:id/tariff", async (req, res) => {
  const context = await requireAdminContext(req, res);
  if (!context) {
    return;
  }

  const userId = sanitizeAdminUserId(req.params?.id);
  if (!userId) {
    return res.status(400).json({ error: "Invalid user id." });
  }

  const tariff = sanitizeAdminTariff(req.body?.tariff ?? req.body?.plan);
  if (!tariff) {
    return res.status(400).json({
      error: "Invalid tariff. Allowed: free, pro, enterprise.",
    });
  }

  try {
    const user = await getAdminUserById(userId);
    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }

    const userMetadata = ensurePlainObject(user.user_metadata)
      ? { ...user.user_metadata }
      : {};

    userMetadata.tariff = tariff;
    userMetadata.plan = tariff;

    const updated = await supabaseAuthAdmin(`/users/${encodeURIComponent(userId)}`, {
      method: "PUT",
      body: {
        user_metadata: userMetadata,
      },
    });

    const updatedUser =
      ensurePlainObject(updated?.user) ? updated.user : ensurePlainObject(updated) ? updated : user;

    return res.status(200).json({
      ok: true,
      user: mapAdminUser(updatedUser),
    });
  } catch (error) {
    const payload = formatErrorPayload(error, "Unable to change user tariff.");
    return res.status(error.status || 500).json(payload);
  }
});

app.post("/api/v1/admin/users/:id/impersonate", async (req, res) => {
  const context = await requireAdminContext(req, res);
  if (!context) {
    return;
  }

  const userId = sanitizeAdminUserId(req.params?.id);
  if (!userId) {
    return res.status(400).json({ error: "Invalid user id." });
  }

  try {
    const user = await getAdminUserById(userId);
    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }

    const email = String(user.email || "").trim().toLowerCase();
    if (!email) {
      return res.status(400).json({ error: "User email is not available." });
    }

    const origin = `${req.protocol}://${req.get("host") || `localhost:${port}`}`;
    const redirectToRaw = String(req.body?.redirectTo || "").trim();
    const redirectTo = redirectToRaw || `${origin}/login`;

    const payload = await supabaseAuthAdmin("/generate_link", {
      method: "POST",
      body: {
        type: "magiclink",
        email,
        redirect_to: redirectTo,
        options: {
          redirectTo,
          redirect_to: redirectTo,
        },
      },
    });

    const actionLink = getGenerateLinkFromPayload(payload);
    if (!actionLink) {
      return res.status(502).json({
        error: "Unable to generate impersonation link.",
      });
    }

    return res.status(200).json({
      ok: true,
      userId,
      email,
      redirectTo,
      actionLink,
    });
  } catch (error) {
    const payload = formatErrorPayload(error, "Unable to generate impersonation link.");
    return res.status(error.status || 500).json(payload);
  }
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
    const canManagePreinstalled = isPreinstalledAssetManager(context.user);

    const rows = await listLibraryAssetsRows(context.token, workspaceId, assetType);
    const items = await Promise.all(
      rows.map((row) => mapLibraryAsset(row, { canManagePreinstalled }))
    );

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
    const canManagePreinstalled = isPreinstalledAssetManager(context.user);
    const workspaceId = canManagePreinstalled
      ? null
      : await resolveWorkspaceForAssetWrite(
          context.token,
          context.user,
          req.body?.workspaceId
        );

    const extension = getUploadExtFromMime(normalizedMime);
    const assetId = crypto.randomUUID();
    const objectKey = canManagePreinstalled
      ? `${LOCAL_ASSET_PREFIX}/preinstalled/${assetType}/${assetId}.${extension}`
      : `${LOCAL_ASSET_PREFIX}/${workspaceId}/${assetType}/${assetId}.${extension}`;
    const { width, height } = parseImageDimensions(file.buffer);
    const fileUrl = await putAssetObject(objectKey, file.buffer, normalizedMime);

    let insertedRow = null;
    try {
      if (canManagePreinstalled) {
        if (!SUPABASE_SERVICE_ROLE_KEY) {
          const configError = new Error(
            "Preinstalled upload is not configured. Missing SUPABASE_SERVICE_ROLE_KEY."
          );
          configError.status = 500;
          throw configError;
        }

        insertedRow = (
          await supabasePublicRest("/library_assets", {
            method: "POST",
            prefer: "return=representation",
            body: {
              id: assetId,
              type: assetType,
              title,
              source: "preinstalled",
              file_url: fileUrl,
              thumbnail_url: fileUrl,
              mime_type: normalizedMime,
              file_size_bytes: Number(file.size || 0),
              width,
              height,
              workspace_id: null,
              owner_id: null,
              s3_key: null,
              metadata_json: {
                originalFilename: String(file.originalname || "").slice(0, 260),
                storageDriver: ASSET_STORAGE_DRIVER,
                storageObjectKey: objectKey,
              },
              is_active: true,
            },
          })
        )[0];
      } else {
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
      }
    } catch (error) {
      await deleteAssetObject(objectKey, fileUrl);
      throw error;
    }

    const mapped = await mapLibraryAsset(insertedRow, {
      canManagePreinstalled,
    });
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
    const canManagePreinstalled = isPreinstalledAssetManager(context.user);
    const row = await getLibraryAssetRowById(context.token, assetId);
    if (!row || !row.is_active) {
      return res.status(404).json({ error: "Asset not found." });
    }

    const item = await mapLibraryAsset(row, { canManagePreinstalled });
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
    const canManagePreinstalled = isPreinstalledAssetManager(context.user);
    const row = await getLibraryAssetRowById(context.token, assetId);
    if (!row || !row.is_active) {
      return res.status(404).json({ error: "Asset not found." });
    }

    if (row.type !== "character") {
      return res.status(400).json({ error: "Only character assets support profile editing." });
    }

    if (row.source === "preinstalled" && !canManagePreinstalled) {
      return res.status(403).json({ error: "Preinstalled assets cannot be edited." });
    }

    if (row.source === "user_upload") {
      const membership = await getMembershipForWorkspace(
        context.token,
        context.user.id,
        row.workspace_id
      );

      if (!membership || (membership.role !== "owner" && membership.role !== "editor")) {
        return res.status(403).json({ error: "No permission to edit this asset." });
      }
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

    let updatedRows = [];
    if (row.source === "preinstalled" && canManagePreinstalled) {
      if (!SUPABASE_SERVICE_ROLE_KEY) {
        return res.status(500).json({
          error: "Preinstalled edit is not configured. Missing SUPABASE_SERVICE_ROLE_KEY.",
        });
      }
      updatedRows = await supabasePublicRest(`/library_assets?id=eq.${encodeURIComponent(assetId)}`, {
        method: "PATCH",
        prefer: "return=representation",
        body: patch,
      });
    } else {
      updatedRows = await supabaseRest(`/library_assets?id=eq.${encodeURIComponent(assetId)}`, {
        method: "PATCH",
        token: context.token,
        prefer: "return=representation",
        body: patch,
      });
    }

    const updated = updatedRows[0] || row;
    const item = await mapLibraryAsset(updated, {
      canManagePreinstalled,
    });
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
    const canManagePreinstalled = isPreinstalledAssetManager(context.user);
    const row = await getLibraryAssetRowById(context.token, assetId);
    if (!row || !row.is_active) {
      return res.status(404).json({ error: "Asset not found." });
    }

    if (row.type !== "character") {
      return res.status(400).json({ error: "Emotion uploads are allowed only for characters." });
    }

    if (row.source === "preinstalled" && !canManagePreinstalled) {
      return res.status(403).json({ error: "Preinstalled assets cannot be edited." });
    }

    if (row.source === "user_upload") {
      const membership = await getMembershipForWorkspace(
        context.token,
        context.user.id,
        row.workspace_id
      );

      if (!membership || (membership.role !== "owner" && membership.role !== "editor")) {
        return res.status(403).json({ error: "No permission to edit this asset." });
      }
    }

    const extension = getUploadExtFromMime(normalizedMime);
    const uploadId = crypto.randomUUID();
    const storageScope = row.source === "preinstalled" ? "preinstalled" : String(row.workspace_id || "unknown");
    const objectKey = `${LOCAL_ASSET_PREFIX}/${storageScope}/character-emotions/${row.id}/${emotionState}-${uploadId}.${extension}`;
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
      if (row.source === "preinstalled" && canManagePreinstalled) {
        if (!SUPABASE_SERVICE_ROLE_KEY) {
          return res.status(500).json({
            error: "Preinstalled edit is not configured. Missing SUPABASE_SERVICE_ROLE_KEY.",
          });
        }
        updatedRows = await supabasePublicRest(`/library_assets?id=eq.${encodeURIComponent(assetId)}`, {
          method: "PATCH",
          prefer: "return=representation",
          body: {
            metadata_json: metadata,
          },
        });
      } else {
        updatedRows = await supabaseRest(`/library_assets?id=eq.${encodeURIComponent(assetId)}`, {
          method: "PATCH",
          token: context.token,
          prefer: "return=representation",
          body: {
            metadata_json: metadata,
          },
        });
      }
    } catch (error) {
      await deleteAssetObject(objectKey, fileUrl);
      throw error;
    }

    if (previousKey && previousKey !== objectKey) {
      await deleteAssetObject(previousKey, previousUrl || "");
    }

    const updated = updatedRows[0] || row;
    const item = await mapLibraryAsset(updated, {
      canManagePreinstalled,
    });
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
    const canManagePreinstalled = isPreinstalledAssetManager(context.user);
    const row = (
      await supabaseRest(
        `/library_assets?select=id,source,workspace_id,s3_key,file_url,metadata_json,is_active&id=eq.${encodeURIComponent(assetId)}&limit=1`,
        { token: context.token }
      )
    )[0];

    if (!row || !row.is_active) {
      return res.status(404).json({ error: "Asset not found." });
    }

    if (row.source !== "user_upload" && !canManagePreinstalled) {
      return res.status(403).json({ error: "Preinstalled assets cannot be deleted." });
    }

    if (row.source === "user_upload") {
      const membership = await getMembershipForWorkspace(
        context.token,
        context.user.id,
        row.workspace_id
      );

      if (!membership || (membership.role !== "owner" && membership.role !== "editor")) {
        return res.status(403).json({ error: "No permission to delete this asset." });
      }
    }

    if (row.source === "preinstalled" && canManagePreinstalled) {
      if (!SUPABASE_SERVICE_ROLE_KEY) {
        return res.status(500).json({
          error: "Preinstalled delete is not configured. Missing SUPABASE_SERVICE_ROLE_KEY.",
        });
      }
      await supabasePublicRest(`/library_assets?id=eq.${encodeURIComponent(assetId)}`, {
        method: "PATCH",
        prefer: "return=minimal",
        body: {
          is_active: false,
        },
      });
    } else {
      await supabaseRest(`/library_assets?id=eq.${encodeURIComponent(assetId)}`, {
        method: "PATCH",
        token: context.token,
        prefer: "return=minimal",
        body: {
          is_active: false,
        },
      });
    }

    const metadataObjectKey = ensurePlainObject(row.metadata_json)
      ? normalizeAssetObjectKey(row.metadata_json.storageObjectKey || "")
      : "";
    const primaryObjectKey =
      normalizeAssetObjectKey(row.s3_key || "") ||
      metadataObjectKey ||
      resolveObjectKeyFromAssetUrl(row.file_url);
    if (primaryObjectKey) {
      await deleteAssetObject(primaryObjectKey, row.file_url).catch(() => null);
    }

    const emotionRefs = collectEmotionAssetRefs(row.metadata_json);
    for (const ref of emotionRefs) {
      await deleteAssetObject(ref.key, ref.url).catch(() => null);
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

    await enforceUserSimulatorLimit(context.token, context.user);

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

app.post("/api/v1/builder/dialogs/:id/ai/generate", async (req, res) => {
  const context = await requireUserContext(req, res);
  if (!context) {
    return;
  }

  if (!ensureJsonObject(req.body)) {
    return res.status(400).json({ error: "Request body must be a JSON object." });
  }

  const simulatorId = String(req.params.id || "").trim();
  const description = sanitizeAiScenarioDescription(req.body?.description);
  if (!description || description.length < 12) {
    return res.status(400).json({
      error: "Опишите сценарий минимум в 12 символах.",
    });
  }

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

    const plan = await resolveUserTariffPlan(context.token, context.user);
    if (!hasAiGenerationAccess(plan)) {
      return res.status(403).json({
        error: "ИИ-генерация доступна только на тарифах Pro Educator52 и Institution.",
        code: "ai_tariff_required",
        tariff: plan?.key || "free",
      });
    }

    let scenarioVersion = await getLatestScenarioVersion(context.token, simulator.id);
    if (!scenarioVersion) {
      scenarioVersion = await createInitialScenarioVersion(context.token, simulator, context.user.id);
    }

    const currentSceneType = sanitizeSceneType(
      req.body?.sceneType ??
        scenarioVersion?.metadata_json?.scene_type ??
        "messenger"
    );

    const blueprint = await requestAiScenarioBlueprint({
      description,
      dialogName: simulator.name,
      sceneType: currentSceneType,
    });
    const graph = buildEditorGraphFromAiBlueprint(blueprint);

    const metadata = ensureJsonObject(scenarioVersion.metadata_json)
      ? { ...scenarioVersion.metadata_json }
      : {};
    metadata.editor_graph = graph;
    metadata.scene_type = currentSceneType;
    metadata.ai_generation = {
      generated_at: new Date().toISOString(),
      source: "openai",
      model: OPENAI_MODEL,
      prompt: description,
    };

    const updatedRows = await supabaseRest(
      `/scenario_versions?id=eq.${encodeURIComponent(scenarioVersion.id)}`,
      {
        method: "PATCH",
        token: context.token,
        prefer: "return=representation",
        body: {
          metadata_json: metadata,
          start_step_key: "node_start",
        },
      }
    );

    const updated = updatedRows[0] || scenarioVersion;

    return res.status(200).json({
      ok: true,
      dialogId: simulator.id,
      scenarioVersionId: updated.id,
      revision: updated.updated_at || null,
      graph,
      tariff: {
        key: plan?.key || null,
        title: plan?.title || null,
      },
    });
  } catch (error) {
    const payload = formatErrorPayload(error, "Unable to generate scenario with AI.");
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

    await enforceUserSimulatorLimit(context.token, context.user);

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

    const publishedAtIso = new Date().toISOString();
    const graph = sanitizeEditorGraph(latestVersion?.metadata_json?.editor_graph || null);
    const sceneType = sanitizeSceneType(latestVersion?.metadata_json?.scene_type);
    const assetCatalog = await buildPreviewAssetCatalog(context.token, graph);

    const snapshotJson = {
      simulatorId: simulator.id,
      scenarioVersionId: latestVersion.id,
      schemaVersion: latestVersion.schema_version || "1.0.0",
      publishedAt: publishedAtIso,
      dialogName: simulator.name,
      sceneType,
      graph,
      assetCatalog,
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
            published_at: publishedAtIso,
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
            published_at: publishedAtIso,
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

    const playerBaseUrl = resolvePlayerBaseUrl(req);

    await supabaseRest("/export_artifacts?on_conflict=publication_id,type", {
      method: "POST",
      token: context.token,
      prefer: "resolution=merge-duplicates,return=minimal",
      body: buildExportArtifacts(publication.id, publication.publication_key, playerBaseUrl),
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

    const playerBaseUrl = resolvePlayerBaseUrl(req);
    const artifacts = buildExportArtifacts(publication.id, publication.publication_key, playerBaseUrl);

    await supabaseRest("/export_artifacts?on_conflict=publication_id,type", {
      method: "POST",
      token: context.token,
      prefer: "resolution=merge-duplicates,return=minimal",
      body: artifacts,
    });

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

app.get("/api/v1/publications/:publicationKey/runtime", async (req, res) => {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    return res.status(500).json({
      error: "Backend is not configured. Missing SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY.",
    });
  }

  const publicationKey = String(req.params.publicationKey || "").trim();
  if (!/^[a-zA-Z0-9_-]{6,80}$/.test(publicationKey)) {
    return res.status(400).json({ error: "Invalid publication key." });
  }

  try {
    const publication = (
      await supabasePublicRest(
        `/publications?select=id,simulator_id,scenario_version_id,publication_key,published_at,snapshot_json,is_active&publication_key=eq.${encodeURIComponent(
          publicationKey
        )}&is_active=eq.true&order=published_at.desc&limit=1`,
        {}
      )
    )[0];

    if (!publication) {
      return res.status(404).json({ error: "Publication not found." });
    }

    const snapshot = ensurePlainObject(publication.snapshot_json) ? publication.snapshot_json : {};
    let graph = ensurePlainObject(snapshot.graph) ? snapshot.graph : null;
    let sceneType = sanitizeSceneType(snapshot.sceneType);
    let dialogName = String(snapshot.dialogName || "").trim();
    let assetCatalog = ensurePlainObject(snapshot.assetCatalog) ? snapshot.assetCatalog : null;

    // Backward compatibility for publications created before runtime snapshot fields were added.
    if ((!graph || !Array.isArray(graph.nodes)) && SUPABASE_SERVICE_ROLE_KEY) {
      const scenarioVersionId =
        String(publication.scenario_version_id || snapshot.scenarioVersionId || "").trim() || null;

      if (scenarioVersionId) {
        const versionRow = (
          await supabasePublicRest(
            `/scenario_versions?select=id,simulator_id,metadata_json&id=eq.${encodeURIComponent(
              scenarioVersionId
            )}&limit=1`
          )
        )[0];

        if (versionRow) {
          graph = sanitizeEditorGraph(versionRow?.metadata_json?.editor_graph || null);
          sceneType = sanitizeSceneType(versionRow?.metadata_json?.scene_type || sceneType);
          assetCatalog = await buildPreviewAssetCatalog(SUPABASE_SERVICE_ROLE_KEY, graph);
        }
      }
    }

    if (!dialogName && SUPABASE_SERVICE_ROLE_KEY) {
      const simulatorId = String(publication.simulator_id || snapshot.simulatorId || "").trim();
      if (simulatorId) {
        const simulatorRow = (
          await supabasePublicRest(
            `/simulators?select=id,name&id=eq.${encodeURIComponent(simulatorId)}&limit=1`
          )
        )[0];
        dialogName = String(simulatorRow?.name || "").trim();
      }
    }

    if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
      return res.status(409).json({
        error:
          "Publication snapshot is outdated. Please republish this dialog and try embedding again.",
      });
    }

    const payload = buildRuntimePayload({
      dialogId: publication.simulator_id || snapshot.simulatorId || null,
      dialogName: dialogName || "Диалог",
      sceneType,
      graph,
      assetCatalog,
      publicationKey: publication.publication_key,
      publishedAt: publication.published_at || snapshot.publishedAt || null,
      source: "publication",
    });

    return res.status(200).json(payload);
  } catch (error) {
    const payload = formatErrorPayload(error, "Unable to load publication runtime.");
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

app.get("/admin", (_req, res) => {
  res.redirect(302, "/admin/users");
});

app.get("/admin/users", (_req, res) => {
  res.sendFile(path.join(publicDir, "admin", "index.html"));
});

app.get("/admin/rate", (_req, res) => {
  res.sendFile(path.join(publicDir, "admin", "rate.html"));
});

app.get("/assets", (_req, res) => {
  res.sendFile(path.join(publicDir, "assets", "index.html"));
});

app.get("/cabinet", (_req, res) => {
  res.sendFile(path.join(publicDir, "cabinet", "index.html"));
});

const sendCharacterEditPage = (_req, res) => {
  res.sendFile(path.join(publicDir, "assets", "character-edit.html"));
};

app.get("/assets/characters/:id", sendCharacterEditPage);

// Backward compatibility for legacy localized links.
app.get("/assets/персонажей/:id", sendCharacterEditPage);

// Also handle URLs where localized path segments arrive url-encoded.
app.get("/assets/:section/:id", (req, res, next) => {
  const rawSection = String(req.params.section || "").trim();
  let decodedSection = rawSection;
  try {
    decodedSection = decodeURIComponent(rawSection);
  } catch (_error) {
    decodedSection = rawSection;
  }

  const normalizedSection = decodedSection.toLowerCase();
  if (normalizedSection === "characters" || normalizedSection === "персонажей") {
    return sendCharacterEditPage(req, res);
  }
  return next();
});

app.get("/builder/dialog/:id", (_req, res) => {
  res.sendFile(path.join(publicDir, "builder", "editor", "index.html"));
});

app.get("/p/:publicationKey", (_req, res) => {
  res.sendFile(path.join(publicDir, "preview", "index.html"));
});

app.get("/preview/:token", (_req, res) => {
  res.sendFile(path.join(publicDir, "preview", "index.html"));
});

app.get("/export/:publicationKey.html", (req, res) => {
  const publicationKey = String(req.params.publicationKey || "").trim();
  if (!/^[a-zA-Z0-9_-]{6,80}$/.test(publicationKey)) {
    return res.status(400).send("Invalid publication key.");
  }

  const origin = `${req.protocol}://${req.get("host") || `localhost:${port}`}`;
  const iframeSrc = `${origin}/p/${encodeURIComponent(publicationKey)}`;

  return res
    .status(200)
    .type("html")
    .send(`<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <link rel="icon" type="image/svg+xml" href="/logo-small.svg" />
    <title>Dialog Runtime</title>
    <!-- Yandex.Metrika counter -->
    <script type="text/javascript">
      (function(m,e,t,r,i,k,a){
          m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
          m[i].l=1*new Date();
          for (var j = 0; j < document.scripts.length; j++) {if (document.scripts[j].src === r) { return; }}
          k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)
      })(window, document,'script','https://mc.yandex.ru/metrika/tag.js?id=107721459', 'ym');

      ym(107721459, 'init', {ssr:true, webvisor:true, clickmap:true, ecommerce:"dataLayer", referrer: document.referrer, url: location.href, accurateTrackBounce:true, trackLinks:true});
    </script>
    <!-- /Yandex.Metrika counter -->
    <style>
      html,body{margin:0;padding:0;height:100%;background:#f1f5f9}
      iframe{width:100%;height:100%;border:0;display:block}
    </style>
  </head>
  <body>
    <noscript><div><img src="https://mc.yandex.ru/watch/107721459" style="position:absolute; left:-9999px;" alt="" /></div></noscript>
    <iframe src="${iframeSrc}" allowfullscreen loading="lazy"></iframe>
  </body>
</html>`);
});

app.get("/embed.js", (req, res) => {
  const origin = `${req.protocol}://${req.get("host") || `localhost:${port}`}`;
  res.type("application/javascript");
  return res.send(`(function(){
  try {
    var script = document.currentScript;
    if (!script) return;
    var publicationKey = script.getAttribute("data-publication");
    if (!publicationKey) return;
    var iframe = document.createElement("iframe");
    iframe.src = "${origin}/p/" + encodeURIComponent(publicationKey);
    iframe.width = script.getAttribute("data-width") || "100%";
    iframe.height = script.getAttribute("data-height") || "720";
    iframe.frameBorder = "0";
    iframe.setAttribute("allowfullscreen", "true");
    iframe.style.border = "0";
    iframe.style.width = iframe.width;
    iframe.style.maxWidth = "100%";
    script.parentNode.insertBefore(iframe, script.nextSibling);
  } catch (_e) {}
})();`);
});

app.get("/", (_req, res) => {
  return res
    .status(200)
    .type("html")
    .send(`<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <link rel="icon" type="image/svg+xml" href="/logo-small.svg" />
    <title>Redirecting...</title>
    <!-- Yandex.Metrika counter -->
    <script type="text/javascript">
      (function(m,e,t,r,i,k,a){
          m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
          m[i].l=1*new Date();
          for (var j = 0; j < document.scripts.length; j++) {if (document.scripts[j].src === r) { return; }}
          k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)
      })(window, document,'script','https://mc.yandex.ru/metrika/tag.js?id=107721459', 'ym');

      ym(107721459, 'init', {ssr:true, webvisor:true, clickmap:true, ecommerce:"dataLayer", referrer: document.referrer, url: location.href, accurateTrackBounce:true, trackLinks:true});
    </script>
    <!-- /Yandex.Metrika counter -->
  </head>
  <body>
    <noscript><div><img src="https://mc.yandex.ru/watch/107721459" style="position:absolute; left:-9999px;" alt="" /></div></noscript>
    <script>
      (function () {
        function redirectToBuilder() {
          window.location.replace("/builder");
        }
        function redirectToRegister() {
          window.location.replace("/register");
        }
        function readStoredSessionToken() {
          var directToken = String(localStorage.getItem("dialogTrainerAccessToken") || "").trim();
          if (directToken) {
            return { accessToken: directToken, refreshToken: "" };
          }
          var raw = localStorage.getItem("dialogTrainerSession");
          if (!raw) {
            return { accessToken: "", refreshToken: "" };
          }
          try {
            var session = JSON.parse(raw);
            var sessionToken = String((session && session.access_token) || "").trim();
            var refreshToken = String((session && session.refresh_token) || "").trim();
            return { accessToken: sessionToken, refreshToken: refreshToken };
          } catch (_parseError) {
            return { accessToken: "", refreshToken: "" };
          }
        }
        try {
          var hash = String(window.location.hash || "");
          if (hash && hash.indexOf("access_token=") >= 0) {
            var params = new URLSearchParams(hash.slice(1));
            var accessToken = String(params.get("access_token") || "").trim();
            if (accessToken) {
              var refreshToken = String(params.get("refresh_token") || "").trim();
              var tokenType = String(params.get("token_type") || "bearer").trim().toLowerCase() || "bearer";
              var expiresInRaw = Number(params.get("expires_in"));
              var expiresIn = Number.isFinite(expiresInRaw) && expiresInRaw > 0 ? Math.trunc(expiresInRaw) : null;
              var expiresAt = expiresIn ? Math.floor(Date.now() / 1000) + expiresIn : null;
              var session = {
                access_token: accessToken,
                refresh_token: refreshToken || null,
                token_type: tokenType,
                expires_in: expiresIn,
                expires_at: expiresAt
              };
              localStorage.setItem("dialogTrainerSession", JSON.stringify(session));
              localStorage.setItem("dialogTrainerAccessToken", accessToken);
              redirectToBuilder();
              return;
            }
          }
          var stored = readStoredSessionToken();
          if (stored.accessToken) {
            localStorage.setItem("dialogTrainerAccessToken", stored.accessToken);
            redirectToBuilder();
            return;
          }
          if (stored.refreshToken) {
            fetch("/api/v1/auth/refresh", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ refreshToken: stored.refreshToken })
            })
              .then(function (response) {
                return response.json().catch(function () { return {}; }).then(function (payload) {
                  if (!response.ok) {
                    throw new Error(payload && payload.error ? payload.error : "Refresh failed");
                  }
                  return payload;
                });
              })
              .then(function (payload) {
                var session = payload && payload.session && typeof payload.session === "object"
                  ? payload.session
                  : null;
                var accessToken = String((session && session.access_token) || payload.accessToken || "").trim();
                if (!accessToken) {
                  throw new Error("Access token is empty");
                }
                if (!session) {
                  var expiresIn = Number(payload && payload.expiresIn);
                  session = {
                    access_token: accessToken,
                    refresh_token: String(payload && payload.refreshToken || stored.refreshToken || "").trim() || null,
                    token_type: String(payload && payload.tokenType || "bearer").trim().toLowerCase() || "bearer",
                    expires_in: Number.isFinite(expiresIn) && expiresIn > 0 ? Math.trunc(expiresIn) : null,
                    expires_at: Number.isFinite(expiresIn) && expiresIn > 0 ? Math.floor(Date.now() / 1000) + Math.trunc(expiresIn) : null
                  };
                }
                localStorage.setItem("dialogTrainerSession", JSON.stringify(session));
                localStorage.setItem("dialogTrainerAccessToken", accessToken);
                redirectToBuilder();
              })
              .catch(function () {
                redirectToRegister();
              });
            return;
          }
        } catch (_e) {}
        redirectToRegister();
      })();
    </script>
  </body>
</html>`);
});

app.use((_req, res) => {
  res.status(404).json({ error: "Not found." });
});

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Server started at http://localhost:${port}`);
});
