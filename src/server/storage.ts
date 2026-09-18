/**
 * Private object storage. Production uses S3-compatible storage (the client's
 * S3/MinIO); local development falls back to a `.local-storage/` directory so
 * the CV vault, template sources and brand assets work with zero setup.
 * Access is always via the org-scoped path convention
 * `<org_id>/<…>/<file>`; callers must have verified the actor's org membership
 * before touching a path.
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { env } from "./env";

let client: S3Client | null = null;

/** Development fallback root — relative to the project working directory. */
const LOCAL_STORAGE_DIR = path.resolve(
  process.cwd(),
  process.env["LOCAL_STORAGE_DIR"] ?? ".local-storage",
);

function s3Configured(): boolean {
  return Boolean(env.S3_ENDPOINT && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY);
}

function s3(): S3Client {
  if (!client) {
    const endpoint = env.S3_ENDPOINT;
    const accessKeyId = env.S3_ACCESS_KEY_ID;
    const secretAccessKey = env.S3_SECRET_ACCESS_KEY;
    if (!endpoint || !accessKeyId || !secretAccessKey) {
      throw new Error(
        "S3 storage is not configured (S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY required).",
      );
    }
    client = new S3Client({
      endpoint,
      region: env.S3_REGION,
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
    });
  }
  return client;
}

/** Storage is always usable — S3 when configured, the local directory otherwise. */
export function isStorageConfigured(): boolean {
  return true;
}

/** Resolve a key inside the local fallback root, refusing traversal outside it. */
function localPathFor(key: string): string {
  const resolved = path.resolve(LOCAL_STORAGE_DIR, key);
  if (resolved !== LOCAL_STORAGE_DIR && !resolved.startsWith(LOCAL_STORAGE_DIR + path.sep)) {
    throw new Error("Invalid storage key");
  }
  return resolved;
}

async function localPut(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
  const file = localPathFor(key);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, bytes);
  await writeFile(`${file}.ct`, contentType, "utf8");
}

async function localGet(key: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  try {
    const file = localPathFor(key);
    const bytes = await readFile(file);
    let contentType = "application/octet-stream";
    try {
      contentType = (await readFile(`${file}.ct`, "utf8")).trim() || contentType;
    } catch {
      /* sidecar missing — fall back to octet-stream */
    }
    return { bytes, contentType };
  } catch (e) {
    if ((e as { code?: string }).code === "ENOENT") return null;
    throw e;
  }
}

async function localDelete(key: string): Promise<void> {
  const file = localPathFor(key);
  await rm(file, { force: true });
  await rm(`${file}.ct`, { force: true });
}

/** Sanitise a client-supplied filename for safe use as an object key segment. */
export function safeFileName(filename: string): string {
  return filename.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "resume.pdf";
}

export function resumeObjectPath(orgId: string, candidateId: string, filename: string): string {
  return `${orgId}/${candidateId}/${safeFileName(filename)}`;
}

export async function putObject(
  key: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<void> {
  if (!s3Configured()) return localPut(key, bytes, contentType);
  await s3().send(
    new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, Body: bytes, ContentType: contentType }),
  );
}

export async function getObject(key: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  if (!s3Configured()) return localGet(key);
  try {
    const res = await s3().send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
    if (!res.Body) return null;
    const bytes = new Uint8Array(await res.Body.transformToByteArray());
    return { bytes, contentType: res.ContentType ?? "application/octet-stream" };
  } catch (e) {
    const status = (e as { name?: string; $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404 || (e as { name?: string }).name === "NoSuchKey") return null;
    throw e;
  }
}

export async function deleteObject(key: string): Promise<void> {
  if (!s3Configured()) return localDelete(key);
  await s3().send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
}

export async function deletePrefix(prefix: string): Promise<void> {
  if (!s3Configured()) {
    const dir = localPathFor(prefix);
    await rm(dir, { recursive: true, force: true });
    return;
  }
  const { ListObjectsV2Command, DeleteObjectsCommand } = await import("@aws-sdk/client-s3");
  const c = s3();
  let token: string | undefined;
  do {
    const listed = await c.send(
      new ListObjectsV2Command({ Bucket: env.S3_BUCKET, Prefix: prefix, MaxKeys: 1000, ContinuationToken: token }),
    );
    const objects = (listed.Contents ?? []).map((o) => ({ Key: o.Key! })).filter((o) => o.Key);
    if (objects.length) {
      await c.send(new DeleteObjectsCommand({ Bucket: env.S3_BUCKET, Delete: { Objects: objects } }));
    }
    token = listed.IsTruncated ? listed.NextContinuationToken : undefined;
  } while (token);
}

export function contentTypeFor(fileName: string): string {
  if (/\.pdf$/i.test(fileName)) return "application/pdf";
  if (/\.docx$/i.test(fileName)) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (/\.doc$/i.test(fileName)) return "application/msword";
  if (/\.png$/i.test(fileName)) return "image/png";
  if (/\.jpe?g$/i.test(fileName)) return "image/jpeg";
  if (/\.webp$/i.test(fileName)) return "image/webp";
  if (/\.(txt|md)$/i.test(fileName)) return "text/plain";
  return "application/octet-stream";
}
