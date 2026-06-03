// ─────────────────────────────────────────────────────────────
//  Storage service — R2 or local fallback
//
//  If R2_ACCOUNT_ID is set → uses Cloudflare R2
//  Otherwise              → saves to /public/uploads/ locally
//
//  To switch to R2: just fill in R2_* vars in .env
//  No code changes needed.
// ─────────────────────────────────────────────────────────────
const crypto = require('crypto');
const path   = require('path');
const fs     = require('fs');

// ── Local storage (dev / no R2 configured) ────────────────────
const UPLOAD_DIR     = path.join(__dirname, '../../public/uploads');
const UPLOAD_URL_BASE = '/uploads';

function ensureUploadDir() {
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

async function uploadLocal({ buffer, mimetype, eventId }) {
  ensureUploadDir();
  const ext = mimetype === 'image/png' ? 'png' : mimetype === 'image/webp' ? 'webp' : 'jpg';
  const key = `photos-${eventId}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, key), buffer);
  const url = `${UPLOAD_URL_BASE}/${key}`;
  return { url, key };
}

async function deleteLocal(key) {
  if (!key) return;
  try {
    // key is just the filename for local storage
    const filename = path.basename(key);
    const filepath = path.join(UPLOAD_DIR, filename);
    if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
  } catch (err) {
    console.error('Local delete error:', err);
  }
}

// ── R2 storage (production) ───────────────────────────────────
async function uploadR2({ buffer, mimetype, eventId }) {
  const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
  const ext    = mimetype === 'image/png' ? 'png' : mimetype === 'image/webp' ? 'webp' : 'jpg';
  const key    = `photos/${eventId}/${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
  const client = new S3Client({
    region:   'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId:     process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
  await client.send(new PutObjectCommand({
    Bucket:      process.env.R2_BUCKET_NAME,
    Key:         key,
    Body:        buffer,
    ContentType: mimetype,
  }));
  const url = `${process.env.R2_PUBLIC_URL}/${key}`;
  return { url, key };
}

async function deleteR2(key) {
  if (!key) return;
  try {
    const { S3Client, DeleteObjectCommand } = require('@aws-sdk/client-s3');
    const client = new S3Client({
      region:   'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId:     process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    });
    await client.send(new DeleteObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key:    key,
    }));
  } catch (err) {
    console.error('R2 delete error:', err);
  }
}

// ── Auto-select based on config ───────────────────────────────
function isR2Configured() {
  return !!(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_BUCKET_NAME);
}

async function uploadPhoto(opts) {
  if (isR2Configured()) {
    console.log('Storage: R2');
    return uploadR2(opts);
  }
  console.log('Storage: local (/public/uploads/)');
  return uploadLocal(opts);
}

async function deletePhoto(key) {
  if (isR2Configured()) return deleteR2(key);
  return deleteLocal(key);
}

module.exports = { uploadPhoto, deletePhoto };
