import { cryptoObj, shouldUseDevCryptoFallback } from './crypto.js';

// Base32 字母表
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

// --- 编码 / 解码工具 ---

export function base32ToBytes(str) {
  let bits = 0
  let value = 0
  let index = 0
  const cleaned = str.toUpperCase().replace(/=+$/, '').replace(/[^A-Z2-7]/g, '')
  const buffer = new Uint8Array(Math.ceil(cleaned.length * 5 / 8))

  for (let i = 0; i < cleaned.length; i++) {
    const val = ALPHABET.indexOf(cleaned[i])
    if (val === -1) continue
    value = (value << 5) | val
    bits += 5
    if (bits >= 8) {
      buffer[index++] = (value >>> (bits - 8)) & 0xFF
      bits -= 8
    }
  }
  return buffer.slice(0, index)
}

export function bytesToBase32(buffer) {
  let bits = 0
  let value = 0
  let output = ''
  const bytes = new Uint8Array(buffer)

  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i]
    bits += 8
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) {
    output += ALPHABET[(value << (5 - bits)) & 31]
  }
  return output
}

export function hexToBytes(hex) {
  const cleaned = hex.replace(/[^0-9a-fA-F]/g, '')
  if (cleaned.length % 2 !== 0) return new Uint8Array(0)
  const bytes = new Uint8Array(cleaned.length / 2)
  for (let i = 0; i < cleaned.length; i += 2) {
    bytes[i / 2] = parseInt(cleaned.substr(i, 2), 16)
  }
  return bytes
}

export function bytesToHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

export function asciiToBytes(str) {
  const buffer = new Uint8Array(str.length)
  for (let i = 0; i < str.length; i++) {
    buffer[i] = str.charCodeAt(i)
  }
  return buffer
}

export function bytesToAscii(buffer) {
  return String.fromCharCode.apply(null, new Uint8Array(buffer))
}

export function base64ToBytes(str) {
  try {
    const binaryString = atob(str.trim())
    const bytes = new Uint8Array(binaryString.length)
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i)
    }
    return bytes
  } catch (e) {
    return new Uint8Array(0)
  }
}

export function bytesToBase64(buffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

// --- TOTP 计算核心 ---

/**
 * 获取基于真实服务器时间（如果有离线偏差缓存）的当前准确时间戳 (单位：毫秒)
 */
export function getAccurateTime() {
  const cachedOffset = localStorage.getItem('app_time_offset')
  const timeDriftMs = cachedOffset ? parseInt(cachedOffset, 10) : 0
  return Date.now() + timeDriftMs
}

export async function generateTOTP(secret, period = 30, digits = 6, algorithm = 'SHA-1', offset = 0) {
  if (!secret) return '------'
  try {
    const keyBytes = base32ToBytes(secret)
    if (keyBytes.length === 0) return '------'

    const now = getAccurateTime() / 1000
    const epoch = Math.floor(now / period) + offset
    const timeBuffer = new ArrayBuffer(8)
    const view = new DataView(timeBuffer)
    view.setBigUint64(0, BigInt(epoch), false)

    // Web Crypto API 算法映射 (Steam 内部使用 SHA-1)
    const cryptoAlgo = { name: 'HMAC', hash: algorithm === 'STEAM' ? 'SHA-1' : algorithm }

    let signature;

    if (shouldUseDevCryptoFallback('using hash-wasm fallback for TOTP generation.')) {
      // 仅在开发环境且非安全上下文（例如移动端本地调试无 HTTPS）时，使用 hash-wasm 兜底
      // 这是为了解决移动端局域网调试时无法获取 crypto.subtle 的问题
      const { createHMAC, createSHA1, createSHA256, createSHA512 } = await import('hash-wasm');

      let hasherPromise;
      if (cryptoAlgo.hash === 'SHA-256') {
        hasherPromise = createSHA256();
      } else if (cryptoAlgo.hash === 'SHA-512') {
        hasherPromise = createSHA512();
      } else {
        hasherPromise = createSHA1();
      }

      const hmac = await createHMAC(hasherPromise, keyBytes);
      hmac.init();
      hmac.update(new Uint8Array(timeBuffer));
      const digestHex = hmac.digest('hex');

      const signatureArray = new Uint8Array(digestHex.length / 2);
      for (let i = 0; i < digestHex.length; i += 2) {
        signatureArray[i / 2] = parseInt(digestHex.substring(i, i + 2), 16);
      }
      signature = signatureArray.buffer;
    } else {
      const key = await cryptoObj.subtle.importKey(
        'raw', keyBytes, cryptoAlgo, false, ['sign']
      )
      signature = await cryptoObj.subtle.sign('HMAC', key, timeBuffer)
    }

    const sigView = new DataView(signature)
    // 动态获取 offset (最后一个字节的低4位)
    const offsetByte = sigView.getUint8(signature.byteLength - 1) & 0xf
    let binary = ((sigView.getUint8(offsetByte) & 0x7f) << 24) |
      ((sigView.getUint8(offsetByte + 1) & 0xff) << 16) |
      ((sigView.getUint8(offsetByte + 2) & 0xff) << 8) |
      (sigView.getUint8(offsetByte + 3) & 0xff)

    if (algorithm === 'STEAM') {
      const chars = "23456789BCDFGHJKMNPQRTVWXY"
      let code = ""
      for (let i = 0; i < 5; i++) {
        code += chars.charAt(binary % chars.length)
        binary = Math.floor(binary / chars.length)
      }
      return code
    }

    const otp = binary % Math.pow(10, digits)
    return otp.toString().padStart(digits, '0')
  } catch (e) {
    console.error('TOTP Error', e)
    return 'ERROR'
  }
}

// --- URI 解析 ---

export function parseOtpUri(uri) {
  try {
    if (!uri) return null

    // 1. 处理 steam:// 协议
    if (uri.startsWith('steam://')) {
      const secret = uri.replace('steam://', '').replace(/[\s=]/g, '').toUpperCase()
      if (!secret) return null
      return {
        service: 'Steam',
        account: 'Steam Guard',
        secret,
        digits: 5,
        period: 30,
        algorithm: 'STEAM',
        category: ''
      }
    }

    const url = new URL(uri)
    if (url.protocol !== 'otpauth:') return null

    const params = url.searchParams
    const secret = params.get('secret')
    if (!secret) return null

    const label = decodeURIComponent(url.pathname.replace(/^\//, '').replace(/^totp\//, ''))
    let service = params.get('issuer') || ''
    let account = label

    if (label.includes(':')) {
      const idx = label.indexOf(':')
      const servicePart = label.substring(0, idx).trim()
      const accountPart = label.substring(idx + 1).trim()

      if (!service) service = servicePart
      account = accountPart
    }

    // 2. 自动识别 Steam 厂商并应用 STEAM 算法
    const isSteam = service.toLowerCase() === 'steam' || label.toLowerCase().includes('steam')
    let algorithm = (params.get('algorithm') || 'SHA1').toUpperCase()
      .replace('SHA1', 'SHA-1')
      .replace('SHA256', 'SHA-256')
      .replace('SHA512', 'SHA-512')

    // 兜底：如果算法不被支持（目前仅支持 SHA-1/256/512），回退到 SHA-1
    if (!['SHA-1', 'SHA-256', 'SHA-512'].includes(algorithm)) {
      algorithm = 'SHA-1'
    }

    let digits = parseInt(params.get('digits') || (isSteam ? '5' : '6'), 10)
    // 保护：如果 digits 不是数字，回退
    if (isNaN(digits)) digits = isSteam ? 5 : 6

    let period = parseInt(params.get('period') || '30', 10)
    if (isNaN(period) || period <= 0) period = 30

    return {
      service: service || 'Unknown',
      account: account || 'Unknown',
      secret: secret.replace(/[\s=]/g, '').toUpperCase(),
      digits,
      period,
      algorithm: isSteam ? 'STEAM' : algorithm,
      category: ''
    }
  } catch (e) {
    return null
  }
}

/**
 * 构造标准的 otpauth:// URI (统一 Steam 协议兼容逻辑)
 */
export function buildOtpUri(data) {
  const {
    service, account, secret,
    algorithm = 'SHA1', digits = 6, period = 30
  } = data
  const label = encodeURIComponent(`${service}:${account}`)
  const issuer = encodeURIComponent(service)

  if (algorithm === 'STEAM') {
    // Steam 令牌的非标协议展示
    return `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}`
  }

  const algoParam = algorithm.replace('-', '') // SHA-1 -> SHA1
  return `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=${algoParam}&digits=${digits}&period=${period}`
}