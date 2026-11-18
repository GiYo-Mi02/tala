import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, stat, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { ApiError, requireCondition } from './errors';

export const checksum = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
export const objectKey = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export interface ObjectStore {
  put(key: string, bytes: Buffer): Promise<void>;
  read(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}
export class PrivateDiskStore implements ObjectStore {
  private root: string;
  constructor(root: string) { this.root = resolve(root); }
  private file(key: string) {
    if (!objectKey.test(key)) throw new Error('Invalid internal object key');
    return join(this.root, key);
  }
  async put(key: string, bytes: Buffer) {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const file = this.file(key);
    const fd = await open(file, 'wx', 0o600);
    try {
      await fd.writeFile(bytes);
      await fd.sync();
    } catch (error) {
      await fd.close().catch(() => {});
      await unlink(file).catch(() => {});
      throw error;
    }
    await fd.close();
  }
  read(key: string) { return readFile(this.file(key)); }
  async remove(key: string) {
    try { await unlink(this.file(key)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  async oldKeys(before: number) {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const keys = await readdir(this.root, { withFileTypes: true });
    const result: string[] = [];
    for (const file of keys) {
      if (!file.isFile() || !objectKey.test(file.name)) continue;
      if ((await stat(this.file(file.name))).mtimeMs < before) result.push(file.name);
    }
    return result;
  }
}
const pngEnd = Buffer.from('0000000049454e44ae426082','hex');
export async function inspectImage(bytes: Buffer, mime: string, declaredHash: string) {
  const jpeg = bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 &&
    bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
  const png = bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')) &&
    bytes.subarray(-12).equals(pngEnd);
  requireCondition((mime === 'image/jpeg' && jpeg) || (mime === 'image/png' && png),
    415,'INVALID_IMAGE','Send a complete JPEG or PNG matching Content-Type.');
  const sha256 = checksum(bytes);
  requireCondition(sha256 === declaredHash,422,'CHECKSUM_MISMATCH','The uploaded bytes do not match the declared SHA-256.');
  try {
    const image = sharp(bytes, { limitInputPixels: 24_000_000, failOn: 'warning' });
    const { width, height, format, pages, orientation } = await image.metadata();
    if (!width || !height || width > 8000 || height > 8000 || (pages ?? 1) !== 1 ||
        (orientation ?? 1) !== 1 || (mime === 'image/jpeg' ? format !== 'jpeg' : format !== 'png')) throw new Error();
    await image.resize(32, 32, { fit: 'inside' }).raw().toBuffer();
    return { width, height, sha256, mime, byteSize: bytes.length, objectKey: randomUUID() };
  } catch {
    throw new ApiError(415,'INVALID_IMAGE','The image could not be decoded as an upright, single-page JPEG or PNG within the size limits.');
  }
}
