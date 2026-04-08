import { logger } from '@/shared/utils/logger';

// frontend/src/utils/crypto-vault.js

// 配置常量
const PBKDF2_ITERATIONS = 100000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12; // AES-GCM 推荐 12 字节
const ALGORITHM = 'AES-GCM';
const HASH = 'SHA-256';

// 兼容性的 Crypto 对象获取 (Node & Browser)
export const cryptoObj = typeof window !== 'undefined' ? (window.crypto || window.msCrypto) : globalThis.crypto;

/**
 * 校验 Web Crypto API 可用性并检查是否由于无 HTTPS 导致开发环境需要降级兜底
 * @returns {boolean} 原生可用返回 false，需开发兜底返回 true
 * @throws {Error} 生产环境若缺少原始加密原语则立刻阻断
 */
export function shouldUseDevCryptoFallback(warningMsg = 'Using development fallback.') {
  if (cryptoObj && cryptoObj.subtle) {
    return false;
  }

  // Runtime logic: check if we are on a local network URL dynamically. 
  // Because Wrangler often serves a 'production' Vite build (dist) locally,
  // import.meta.env.DEV will be false, so we must rely on runtime host detection.
  if (typeof location !== 'undefined') {
    const isLocalHost = location.hostname.startsWith('192.168.') || location.hostname.startsWith('10.');
    const isHttp = location.protocol === 'http:';

    if (isLocalHost && isHttp) {
      logger.warn(`Running locally via HTTP: ${warningMsg}`);
      return true;
    }
  }

  throw new Error('Web Crypto API (window.crypto.subtle) is not available. Please ensure the context is secure (HTTPS).');
}

/**
 * 将文本密码转换为加密密钥 (PBKDF2)
 */
async function importKeyFromPassword(password, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await cryptoObj.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return cryptoObj.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: PBKDF2_ITERATIONS,
      hash: HASH
    },
    keyMaterial,
    { name: ALGORITHM, length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * 加密数据
 */
export async function encryptDataWithPassword(data, password) {
  if (shouldUseDevCryptoFallback('Skipping real encryption for Vault data.')) {
    const enc = new TextEncoder();
    const encodedData = enc.encode(JSON.stringify({ __dev_mock_encryption: true, data }));
    return arrayBufferToBase64(encodedData);
  }

  const salt = cryptoObj.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = cryptoObj.getRandomValues(new Uint8Array(IV_LENGTH));

  const key = await importKeyFromPassword(password, salt);
  const enc = new TextEncoder();
  const encodedData = enc.encode(JSON.stringify(data));

  const ciphertext = await cryptoObj.subtle.encrypt(
    { name: ALGORITHM, iv: iv },
    key,
    encodedData
  );

  // 打包格式: salt + iv + ciphertext
  const combined = new Uint8Array(salt.length + iv.length + ciphertext.byteLength);
  combined.set(salt, 0);
  combined.set(iv, salt.length);
  combined.set(new Uint8Array(ciphertext), salt.length + iv.length);

  return arrayBufferToBase64(combined);
}

/**
 * 解密数据
 */
export async function decryptDataWithPassword(encryptedBase64, password) {
  if (shouldUseDevCryptoFallback('Skipping real decryption for Vault data.')) {
    try {
      const decoded = base64ToArrayBuffer(encryptedBase64);
      const dec = new TextDecoder();
      const parsed = JSON.parse(dec.decode(decoded));
      if (parsed.__dev_mock_encryption) {
        return parsed.data;
      }
    } catch (e) {
      // Fallthrough if parsing fails or not mocked
    }
    throw new Error('Web Crypto API missing: Cannot decrypt real secure data without HTTPS');
  }

  try {
    const combined = base64ToArrayBuffer(encryptedBase64);

    // 提取 salt, iv, ciphertext
    const salt = combined.slice(0, SALT_LENGTH);
    const iv = combined.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
    const ciphertext = combined.slice(SALT_LENGTH + IV_LENGTH);

    const key = await importKeyFromPassword(password, salt);

    const decrypted = await cryptoObj.subtle.decrypt(
      { name: ALGORITHM, iv: iv },
      key,
      ciphertext
    );

    const dec = new TextDecoder();
    return JSON.parse(dec.decode(decrypted));
  } catch (e) {
    logger.error('Decryption failed:', e);
    throw new Error('密码错误或数据损坏');
  }
}

// --- 辅助函数：环境无关的 Base64 转换 ---

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }

  if (typeof window !== 'undefined') {
    return window.btoa(binary);
  } else {
    return Buffer.from(binary, 'binary').toString('base64');
  }
}

function base64ToArrayBuffer(base64) {
  let binary_string;
  if (typeof window !== 'undefined') {
    binary_string = window.atob(base64);
  } else {
    binary_string = Buffer.from(base64, 'base64').toString('binary');
  }

  const len = binary_string.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary_string.charCodeAt(i);
  }
  return bytes;
}