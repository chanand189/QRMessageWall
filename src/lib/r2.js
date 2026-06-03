// ─────────────────────────────────────────────────────────────
//  R2 Storage service
//  Cloudflare R2 is S3-compatible so we use the AWS SDK
//
//  uploadPhoto  — uploads buffer to R2, returns { url, key }
//  deletePhoto  — deletes object from R2 by key
// ─────────────────────────────────────────────────────────────
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const crypto = require('crypto');

let _client = null;

function getClient() {
  if (_client) return _client;
  _client = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId:     process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
  return _client;
}

async function uploadPhoto({ buffer, mimetype, eventId }) {
  const ext    = mimetype === 'image/png' ? 'png' : mimetype === 'image/webp' ? 'webp' : 'jpg';
  const key    = `photos/${eventId}/${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
  const client = getClient();

  await client.send(new PutObjectCommand({
    Bucket:      process.env.R2_BUCKET_NAME,
    Key:         key,
    Body:        buffer,
    ContentType: mimetype,
  }));

  // Public URL via R2 public bucket URL
  const url = `${process.env.R2_PUBLIC_URL}/${key}`;
  return { url, key };
}

async function deletePhoto(key) {
  if (!key) return;
  try {
    const client = getClient();
    await client.send(new DeleteObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key:    key,
    }));
  } catch (err) {
    console.error('R2 delete error:', err);
  }
}

module.exports = { uploadPhoto, deletePhoto };
