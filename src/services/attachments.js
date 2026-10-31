import { createHash, randomUUID } from 'node:crypto';
import { imageSize } from 'image-size';
import { config } from '../config/index.js';
import { HttpError } from '../errors.js';

const ALLOWED_TYPES = new Map([
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['png', 'image/png'],
  ['webp', 'image/webp'],
]);

const attachments = new Map();
let cleanupTimer = null;

function ownerHash(ownerKey) {
  return createHash('sha256').update(String(ownerKey || 'unknown')).digest('hex');
}

function sanitiseFileName(name, extension) {
  const base = String(name || '')
    .split(/[\\/]/)
    .pop()
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return base || `image.${extension}`;
}

function toPublic(record) {
  return {
    id: record.id,
    name: record.name,
    mimeType: record.mimeType,
    size: record.size,
    width: record.width,
    height: record.height,
    createdAt: new Date(record.createdAt).toISOString(),
    expiresAt: new Date(record.expiresAt).toISOString(),
  };
}

function totalBytes() {
  let total = 0;
  for (const record of attachments.values()) total += record.size;
  return total;
}

function evictOldest() {
  let oldest = null;
  for (const record of attachments.values()) {
    if (!oldest || record.createdAt < oldest.createdAt) oldest = record;
  }
  if (oldest) attachments.delete(oldest.id);
}

export function cleanupExpired() {
  const now = Date.now();
  let removed = 0;
  for (const [id, record] of attachments.entries()) {
    if (record.expiresAt <= now) {
      attachments.delete(id);
      removed += 1;
    }
  }
  return removed;
}

export function startAttachmentCleanup() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(cleanupExpired, 5 * 60 * 1000);
  cleanupTimer.unref?.();
}

export function stopAttachmentCleanup() {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

export function validateAndStoreImage({ buffer, originalName, ownerKey }) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new HttpError(400, 'empty_image', 'The uploaded image is empty.');
  }
  if (buffer.length > config.limits.maxImageBytes) {
    throw new HttpError(
      413,
      'image_too_large',
      `The image is larger than the ${config.limits.maxImageMb} MB limit.`
    );
  }

  let dimensions;
  try {
    dimensions = imageSize(buffer);
  } catch {
    throw new HttpError(
      422,
      'invalid_image',
      'The file could not be read as an image. Upload a valid JPEG, PNG, or WebP file.'
    );
  }

  const type = String(dimensions?.type || '').toLowerCase();
  const mimeType = ALLOWED_TYPES.get(type);
  if (!mimeType) {
    throw new HttpError(
      415,
      'unsupported_image_type',
      'Only JPEG, PNG, and WebP images are supported.'
    );
  }

  const width = Number(dimensions.width);
  const height = Number(dimensions.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw new HttpError(422, 'invalid_image', 'The image has invalid dimensions.');
  }
  if (width < 16 || height < 16) {
    throw new HttpError(
      422,
      'image_too_small',
      'The image is too small to analyze. Upload an image at least 16 x 16 pixels.'
    );
  }
  if (width * height > 40_000_000) {
    throw new HttpError(
      422,
      'image_dimensions_too_large',
      'The image dimensions are too large. Try a smaller or compressed image.'
    );
  }

  if (attachments.size >= config.attachments.maxCount) evictOldest();
  while (
    attachments.size > 0 &&
    totalBytes() + buffer.length > config.attachments.maxTotalBytes
  ) {
    evictOldest();
  }

  const now = Date.now();
  const record = {
    id: randomUUID(),
    buffer: Buffer.from(buffer),
    mimeType,
    size: buffer.length,
    width,
    height,
    name: sanitiseFileName(originalName, type === 'jpeg' ? 'jpg' : type),
    ownerHash: ownerHash(ownerKey),
    createdAt: now,
    expiresAt: now + config.attachments.ttlMs,
  };
  attachments.set(record.id, record);
  return toPublic(record);
}

export function getAttachment(id, ownerKey) {
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new HttpError(400, 'invalid_attachment_id', 'The image reference is not valid.');
  }
  const record = attachments.get(id);
  if (!record) {
    throw new HttpError(
      410,
      'attachment_expired',
      'That image is no longer available. Please upload it again.'
    );
  }
  if (record.expiresAt <= Date.now()) {
    attachments.delete(id);
    throw new HttpError(
      410,
      'attachment_expired',
      'That image is no longer available. Please upload it again.'
    );
  }
  if (record.ownerHash !== ownerHash(ownerKey)) {
    // Do not reveal whether another user's attachment exists.
    throw new HttpError(
      410,
      'attachment_expired',
      'That image is no longer available. Please upload it again.'
    );
  }
  return record;
}

export function deleteAttachment(id, ownerKey) {
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) {
    throw new HttpError(400, 'invalid_attachment_id', 'The image reference is not valid.');
  }
  const record = attachments.get(id);
  if (!record) return false;
  if (record.ownerHash !== ownerHash(ownerKey)) return false;
  return attachments.delete(id);
}

export function getAttachmentStats() {
  cleanupExpired();
  return {
    active: attachments.size,
    totalBytes: totalBytes(),
    ttlMinutes: Math.round(config.attachments.ttlMs / 60000),
  };
}

export const __testing = { attachments, cleanupExpired, totalBytes };
