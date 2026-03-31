import { sanitizeInput } from '@/shared/utils/common';

export function validateBase32Secret(secret: any): boolean {
    if (!secret || typeof secret !== 'string') return false;
    const cleaned = secret.replace(/\s/g, '').toUpperCase();
    return /^[A-Z2-7]+=*$/.test(cleaned) && cleaned.length >= 8;
}

const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Decode(encoded: string): Uint8Array {
    const cleanInput = encoded.toUpperCase().replace(/[^A-Z2-7]/g, '');
    const buffer = new Uint8Array(Math.floor(cleanInput.length * 5 / 8));
    let bits = 0, value = 0, index = 0;

    for (let i = 0; i < cleanInput.length; i++) {
        const charValue = BASE32_CHARS.indexOf(cleanInput[i]);
        if (charValue === -1) continue;
        value = (value << 5) | charValue;
        bits += 5;
        if (bits >= 8) {
            buffer[index++] = (value >>> (bits - 8)) & 255;
            bits -= 8;
        }
    }
    return buffer;
}

/**
 * 通用 HMAC 计算
 */
export async function hmac(key: Uint8Array | string, data: number, algorithm = 'SHA-1'): Promise<Uint8Array> {
    const keyBuffer = typeof key === 'string' ? new TextEncoder().encode(key) : key;
    const dataBuffer = new ArrayBuffer(8);
    new DataView(dataBuffer).setBigUint64(0, BigInt(data), false);

    const cryptoKey = await crypto.subtle.importKey(
        'raw',
        keyBuffer as any,
        { name: 'HMAC', hash: algorithm },
        false,
        ['sign']
    );
    // @ts-ignore
    const signature = await crypto.subtle.sign('HMAC', cryptoKey, dataBuffer as any as ArrayBuffer);
    return new Uint8Array(signature);
}

export async function generateTOTP(secret: string | Uint8Array, timeStep = 30, digits = 6, algorithm = 'SHA-1'): Promise<string> {
    const time = Math.floor(Date.now() / 1000 / timeStep);
    const secretBytes = typeof secret === 'string' ? base32Decode(secret) : secret;

    // Steam 内部使用 SHA-1
    const cryptoAlgo = algorithm === 'STEAM' ? 'SHA-1' : algorithm;
    const hmacResult = await hmac(secretBytes, time, cryptoAlgo);
    const offset = hmacResult[hmacResult.length - 1] & 0xf;

    let binary = ((hmacResult[offset] & 0x7f) << 24) |
        ((hmacResult[offset + 1] & 0xff) << 16) |
        ((hmacResult[offset + 2] & 0xff) << 8) |
        (hmacResult[offset + 3] & 0xff);

    if (algorithm === 'STEAM') {
        const chars = "23456789BCDFGHJKMNPQRTVWXY";
        let code = "";
        for (let i = 0; i < 5; i++) {
            code += chars.charAt(binary % chars.length);
            binary = Math.floor(binary / chars.length);
        }
        return code;
    }

    const code = binary % Math.pow(10, digits);
    return code.toString().padStart(digits, '0');
}

export function parseOTPAuthURI(uri: string) {
    try {
        if (!uri || typeof uri !== 'string' || uri.length > 2000) return null;

        // 1. 处理 steam:// 协议
        if (uri.startsWith('steam://')) {
            const secret = uri.replace('steam://', '').replace(/[\s=]/g, '').toUpperCase();
            if (!validateBase32Secret(secret)) return null;
            return {
                type: 'totp',
                label: 'Steam Guard',
                issuer: 'Steam',
                account: 'Steam Guard',
                secret,
                digits: 5,
                period: 30,
                algorithm: 'STEAM'
            };
        }

        const url = new URL(uri);
        if (url.protocol !== 'otpauth:') return null;

        const type = url.hostname;
        if (type !== 'totp' && type !== 'hotp') return null;

        const label = decodeURIComponent(url.pathname.substring(1));
        const params = new URLSearchParams(url.search);

        const secret = params.get('secret');
        if (!validateBase32Secret(secret)) return null;

        const [issuer, account] = label.includes(':') ? label.split(':', 2) : ['', label];
        const issuerName = sanitizeInput(params.get('issuer') || issuer, 50);
        const isSteam = issuerName.toLowerCase() === 'steam' || label.toLowerCase().includes('steam');

        const digits = parseInt(params.get('digits') || (isSteam ? '5' : '6'));
        const period = parseInt(params.get('period') || '30');

        // 放宽限制以支持 5 位 Steam 验证码
        if (digits < 5 || digits > 8 || period < 15 || period > 300) return null;

        return {
            type,
            label: sanitizeInput(label, 100),
            issuer: issuerName,
            account: sanitizeInput(account || label, 100),
            secret: secret!.replace(/[\s=]/g, '').toUpperCase(),
            algorithm: isSteam ? 'STEAM' : (params.get('algorithm') || 'SHA-1').toUpperCase()
                .replace('SHA1', 'SHA-1')
                .replace('SHA256', 'SHA-256')
                .replace('SHA512', 'SHA-512'),
            digits,
            period
        };
    } catch {
        return null;
    }
}

/**
 * 构造标准的 otpauth:// URI (统一 Steam 协议兼容逻辑)
 */
export function buildOTPAuthURI(data: {
    service: string;
    account: string;
    secret: string;
    algorithm?: string;
    digits?: number;
    period?: number;
}) {
    const { service, account, secret, algorithm = 'SHA-1', digits = 6, period = 30 } = data;
    const label = encodeURIComponent(`${service}:${account}`);
    const issuer = encodeURIComponent(service);

    if (algorithm === 'STEAM') {
        // Steam 令牌：由于其算法非标，通常导出时通过 issuer 识别
        return `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}`;
    }

    const algoParam = algorithm.replace('-', ''); // SHA-1 -> SHA1
    return `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=${algoParam}&digits=${digits}&period=${period}`;
}

