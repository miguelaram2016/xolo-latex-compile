'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MAX_FILES = 100;
const MAX_TOTAL_BYTES = 25 * 1024 * 1024;
const MAX_PATH_LENGTH = 240;

class InvalidProjectError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InvalidProjectError';
  }
}

function safeRelativePath(filePath) {
  if (typeof filePath !== 'string' || filePath.length === 0 || filePath.length > MAX_PATH_LENGTH) {
    throw new InvalidProjectError('Each file must have a valid path (1–240 characters)');
  }
  if (path.posix.isAbsolute(filePath) || path.win32.isAbsolute(filePath) ||
      filePath.includes('\\') || /[\x00-\x1f\x7f]/.test(filePath)) {
    throw new InvalidProjectError('Unsafe file path: ' + filePath);
  }
  const segments = filePath.split('/');
  if (segments.some(part => !part || part === '.' || part === '..' || part.startsWith('-') ||
      /[<>:"|?*]/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(part))) {
    throw new InvalidProjectError('Unsafe file path: ' + filePath);
  }
  return filePath;
}

function prepareProjectFiles(files) {
  if (!Array.isArray(files) || files.length === 0 || files.length > MAX_FILES) {
    throw new InvalidProjectError('Provide between 1 and ' + MAX_FILES + ' files');
  }

  const seen = new Set();
  let totalBytes = 0;
  const prepared = files.map(file => {
    if (!file || typeof file !== 'object' || Array.isArray(file)) {
      throw new InvalidProjectError('Each file must contain path and content');
    }
    const filePath = safeRelativePath(file.path);
    const key = filePath.toLowerCase(); // Prevent collisions on case-insensitive filesystems.
    if (seen.has(key)) throw new InvalidProjectError('Duplicate file path: ' + filePath);
    seen.add(key);

    if (typeof file.content !== 'string' || (file.encoding != null && file.encoding !== 'base64')) {
      throw new InvalidProjectError('Invalid content or encoding for ' + filePath);
    }
    let bytes;
    if (file.encoding === 'base64') {
      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.content)) {
        throw new InvalidProjectError('Invalid base64 content for ' + filePath);
      }
      bytes = Buffer.from(file.content, 'base64');
    } else {
      // JSON already unescapes newlines; replacing literal '\n' corrupts LaTeX commands.
      bytes = Buffer.from(file.content, 'utf8');
    }
    totalBytes += bytes.length;
    if (totalBytes > MAX_TOTAL_BYTES) throw new InvalidProjectError('Project exceeds 25 MB');
    return { path: filePath, bytes };
  });

  const main = prepared.find(f => f.path === 'main.tex') ||
    prepared.find(f => f.path.endsWith('.tex'));
  if (!main) throw new InvalidProjectError('No .tex file provided');
  return { prepared, main };
}

function writeProjectFiles(tmpDir, prepared) {
  const root = path.resolve(tmpDir);
  for (const file of prepared) {
    const destination = path.resolve(root, file.path);
    if (!destination.startsWith(root + path.sep)) {
      throw new InvalidProjectError('Unsafe file path: ' + file.path);
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, file.bytes, { flag: 'wx' });
  }
}

module.exports = { InvalidProjectError, prepareProjectFiles, safeRelativePath, writeProjectFiles };
