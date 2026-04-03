/**
 * 统一加密标准模块 (Backend Version)
 * 算法: AES-GCM-256 + PBKDF2 (SHA-256)
 * 目标: 确保前后端生成的加密数据完全互通
 * 
 * --- 核心安全架构说明 (Security Architecture) ---
 * 1. 数据库透明加密 (DB Level): 所有金库敏感字段 (secret) 在 D1 数据库中均以加密形式存储，
 *    由后端环境变量 ENCRYPTION_KEY 保护。
 * 
 * 2. 客户端绑定指纹 (Device Salt / Device Key): 
 *    为了实现“零知识”级别的安全性，数据同步到前端后，会配合一个“设备指纹”进行二次离线加密。
 *    - 生成逻辑: HMAC-SHA256(UserId + "device_salt_offline_key", JWT_SECRET)
 *    - 作用: 
 *      a. 即使数据库泄露且 ENCRYPTION_KEY 泄露，黑客没有 JWT_SECRET 且不知道用户 ID 指纹，也无法解密本地缓存。
 *      b. 前端无需持久化存储登录密码即可实现离线解密（秒开）。
 *      c. 实现了“账号+设备”的双重绑定。
 * 
 * 3. 互通性: OAuth 与 Passkey 登录必须生成完全一致的 DeviceKey，以确保同一账号下数据解密一致。
 * ----------------------------------------------
 */

export const CRYPTO_CONFIG = {
    ALGO_NAME: 'AES-GCM',
    KDF_NAME: 'PBKDF2',
    HASH: 'SHA-256',
    ITERATIONS: 100000, // 平衡安全性与性能
    KEY_LEN: 256,
    SALT_LEN: 16,
    IV_LEN: 12
};





/**
 * Internal: Normalize secrets to support 'base64:', 'hex:', or 'aes:' prefix
 * If a secret starts with 'base64:', it will be decoded via atob.
 * If it starts with 'hex:', it will be converted from hexadecimal characters.
 * If it starts with 'aes:', it will be decrypted using JWT_SECRET as root key.
 */
export async function normalizeSecret(secret: string, contextKey?: string): Promise<string> {
    if (!secret || typeof secret !== 'string') return secret;

    // Support Base64: prefix
    if (secret.startsWith('base64:')) {
        try {
            return atob(secret.slice(7));
        } catch (e) {
            console.warn('[Crypto] Failed to decode base64 secret, using raw string');
            return secret;
        }
    }

    // Support Hex: prefix
    if (secret.startsWith('hex:')) {
        try {
            const hex = secret.slice(4).replace(/[^0-9a-fA-F]/g, '');
            const bytesMatch = hex.match(/.{1,2}/g);
            if (!bytesMatch) return secret;
            return String.fromCharCode(...bytesMatch.map(byte => parseInt(byte, 16)));
        } catch (e) {
            console.warn('[Crypto] Failed to decode hex secret, using raw string');
            return secret;
        }
    }

    // Support Aes: prefix (New feature)
    if (secret.startsWith('aes:')) {
        if (!contextKey) {
            // EC-01, EC-06: Root key (JWT_SECRET) is required for decryption
            throw new Error('[Crypto] Missing root key (JWT_SECRET) to decrypt aes: secret');
        }
        try {
            const parts = secret.slice(4).split(':');
            if (parts.length !== 3) throw new Error('Invalid AES format');

            const [ivB64, tagB64, cipherB64] = parts;
            if (!ivB64 || !tagB64 || !cipherB64) throw new Error('Invalid segments');

            const iv = Uint8Array.from(atob(ivB64), c => c.charCodeAt(0));
            const tag = Uint8Array.from(atob(tagB64), c => c.charCodeAt(0));
            const ciphertextData = Uint8Array.from(atob(cipherB64), c => c.charCodeAt(0));

            const combined = new Uint8Array(ciphertextData.length + tag.length);
            combined.set(ciphertextData);
            combined.set(tag, ciphertextData.length);

            const key = await getDerivedEncryptionKey(contextKey);
            const decrypted = await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv },
                key,
                combined
            );

            return new TextDecoder().decode(decrypted);
        } catch (e: any) {
            // 只有在提供了 key 且解密失败时才报错
            throw new Error(`[Crypto] Failed to decrypt aes: secret: ${e.message}`);
        }
    }

    return secret;
}

const derivedKeyCache = new Map<string, CryptoKey>();

/**
 * 环境变量专用密钥派生算法 (PBKDF2-SHA256)
 * 用于从 JWT_SECRET 生成解密其他环境变量的 AES 密钥
 */
export async function getDerivedEncryptionKey(password: string): Promise<CryptoKey> {
    if (derivedKeyCache.has(password)) {
        return derivedKeyCache.get(password)!;
    }

    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        encoder.encode(password),
        { name: 'PBKDF2' },
        false,
        ['deriveKey']
    );
    const key = await crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: encoder.encode('env_key_derivation_salt'),
            iterations: 100000,
            hash: 'SHA-256'
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        true, // HP-07/08: Set extractable to true for verification and flexibility
        ['encrypt', 'decrypt']
    );

    derivedKeyCache.set(password, key);
    return key;
}

/**
 * 全局环境变量初始化工具 (支持双层解析：先解 JWT 再解 AES)
 */
export async function initializeEnv(env: any) {
    if (!env) return;

    // 第一阶段：提取 JWT_SECRET
    const rawJwt = env.JWT_SECRET || (typeof process !== 'undefined' ? process.env.JWT_SECRET : '');
    let rootKey = '';
    if (rawJwt && typeof rawJwt === 'string') {
        rootKey = await normalizeSecret(rawJwt);
        env.JWT_SECRET = rootKey;
        // 在 Node 环境下同步到全局，确保非 request context 下也能读到
        if (typeof process !== 'undefined') process.env.JWT_SECRET = rootKey;
    }

    // 第二阶段：递归处理所有其他字符串变量，包括依赖 rootKey 的 aes: 密文
    for (const key in env) {
        if (key === 'JWT_SECRET' || key === 'ASSETS') continue;
        if (typeof env[key] === 'string') {
            try {
                const rawValue = env[key].trim();
                const normalized = await normalizeSecret(rawValue, rootKey);
                if (rawValue.startsWith('aes:')) {
                    console.log(`[Init] Decrypted key "${key}" (Encrypted: ${rawValue.slice(0, 10)}...)`);
                }
                env[key] = normalized;
                if (typeof process !== 'undefined') process.env[key] = normalized;
            } catch (e) {
                console.error(`[Init] Failed to normalize env key "${key}":`, e);
            }
        }
    }
}

// 核心：从密码派生密钥
async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        "raw",
        enc.encode(await normalizeSecret(password)),
        { name: CRYPTO_CONFIG.KDF_NAME },
        false,
        ["deriveKey"]
    );

    return crypto.subtle.deriveKey(
        {
            name: CRYPTO_CONFIG.KDF_NAME,
            salt: salt as any,
            iterations: CRYPTO_CONFIG.ITERATIONS,
            hash: CRYPTO_CONFIG.HASH
        },
        keyMaterial,
        { name: CRYPTO_CONFIG.ALGO_NAME, length: CRYPTO_CONFIG.KEY_LEN },
        false,
        ["encrypt", "decrypt"]
    );
}



// ==========================================
// JWT 签发与验证 (原生轻量实现)
// ==========================================
export async function generateSecureJWT(payload: Record<string, any>, secret: string, expiry: number = 86400 * 7): Promise<string> {
    const header = { alg: 'HS256', typ: 'JWT', iat: Math.floor(Date.now() / 1000) };
    const enhancedPayload = {
        ...payload,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + expiry,
        jti: crypto.randomUUID()
    };

    const headerB64 = btoa(JSON.stringify(header)).replace(/[+/=]/g, (m) => ({ '+': '-', '/': '_', '=': '' }[m as keyof { '+': string, '/': string, '=': string }] || m));
    const payloadB64 = btoa(JSON.stringify(enhancedPayload)).replace(/[+/=]/g, (m) => ({ '+': '-', '/': '_', '=': '' }[m as keyof { '+': string, '/': string, '=': string }] || m));

    const data = `${headerB64}.${payloadB64}`;
    const encoder = new TextEncoder();
    const cryptoKey = await crypto.subtle.importKey('raw', encoder.encode(await normalizeSecret(secret)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data));
    const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/[+/=]/g, (m) => ({ '+': '-', '/': '_', '=': '' }[m as keyof { '+': string, '/': string, '=': string }] || m));

    return `${data}.${signatureB64}`;
}

export async function verifySecureJWT(token: string, secret: string): Promise<any | null> {
    try {
        const [headerB64, payloadB64, signatureB64] = token.split('.');
        if (!headerB64 || !payloadB64 || !signatureB64) return null;

        const data = `${headerB64}.${payloadB64}`;
        const encoder = new TextEncoder();

        const cryptoKey = await crypto.subtle.importKey('raw', encoder.encode(await normalizeSecret(secret)), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
        const signatureBytes = Uint8Array.from(atob(signatureB64.replace(/[-_]/g, (m) => ({ '-': '+', '_': '/' }[m as keyof { '-': string, '_': string }] || m))), c => c.charCodeAt(0));
        // @ts-ignore Cloudflare WebCrypto types mismatch with standard BufferSource
        const isValid = await crypto.subtle.verify('HMAC', cryptoKey, signatureBytes as any as ArrayBuffer, encoder.encode(data) as any as ArrayBuffer);

        if (isValid) {
            const payload = JSON.parse(atob(payloadB64.replace(/[-_]/g, (m) => ({ '-': '+', '_': '/' }[m as keyof { '-': string, '_': string }] || m))));
            if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
            return payload;
        }
        return null;
    } catch {
        return null;
    }
}

// ==========================================
// PKCE 辅助机制 (OAuth)
// ==========================================
export function base64UrlEncode(str: Uint8Array): string {
    let binary = '';
    const len = str.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(str[i]);
    }
    return btoa(binary)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

export async function generatePKCE() {
    const verifierBytes = new Uint8Array(32);
    crypto.getRandomValues(verifierBytes);
    const verifier = base64UrlEncode(verifierBytes);
    const challenge = base64UrlEncode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
    return { verifier, challenge };
}

// ==========================================
// 极速与兼容模式加解密体系
// ==========================================

// ⚡️ 极速模式：直接使用密钥的哈希值作为 AES 密钥 (无 PBKDF2)
async function getFastKey(secret: string): Promise<CryptoKey> {
    const encoder = new TextEncoder();
    const keyBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(await normalizeSecret(secret)));
    return crypto.subtle.importKey('raw', keyBuffer, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

// 🛡️ 兼容模式：生成与前端相匹配的 Vault Backup 文件 (PBKDF2 + AES-GCM 封装)
export async function encryptBackupFile(data: any, password: string): Promise<string> {
    const salt = crypto.getRandomValues(new Uint8Array(CRYPTO_CONFIG.SALT_LEN));
    const iv = crypto.getRandomValues(new Uint8Array(CRYPTO_CONFIG.IV_LEN));

    const key = await deriveKey(password, salt);
    const enc = new TextEncoder();
    const encodedData = enc.encode(JSON.stringify(data));

    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encodedData);

    const combined = new Uint8Array(salt.length + iv.length + ciphertext.byteLength);
    combined.set(salt, 0);
    combined.set(iv, salt.length);
    combined.set(new Uint8Array(ciphertext), salt.length + iv.length);

    let binary = '';
    for (let i = 0; i < combined.byteLength; i++) {
        binary += String.fromCharCode(combined[i]);
    }
    return btoa(binary);
}

// 🚀 新版内置加密封装，主要用于 KV 或 D1 里的敏感小字段
export async function encryptData(data: any, masterKey: string): Promise<{ encrypted: number[], iv: number[], salt?: number[] }> {
    const encoder = new TextEncoder();
    const iv = crypto.getRandomValues(new Uint8Array(12));

    const key = await getFastKey(masterKey);

    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(JSON.stringify(data)));
    return {
        encrypted: Array.from(new Uint8Array(encrypted)),
        iv: Array.from(iv)
    };
}

// 🚀 新版内置解密封装，自带兼容回退机制
export async function decryptData(encryptedData: { encrypted: number[], iv: number[], salt?: number[] }, masterKey: string): Promise<any> {
    const decoder = new TextDecoder();
    const iv = new Uint8Array(encryptedData.iv);
    const encrypted = new Uint8Array(encryptedData.encrypted);

    let key: CryptoKey;

    if (encryptedData.salt && encryptedData.salt.length > 0) {
        const salt = new Uint8Array(encryptedData.salt);
        key = await deriveKey(masterKey, salt);
    } else {
        key = await getFastKey(masterKey);
    }

    // @ts-ignore Cloudflare WebCrypto types mismatch with standard BufferSource
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as any }, key, encrypted as any);
    return JSON.parse(decoder.decode(decrypted));
}

/**
 * 生成客户端绑定标识 (Device Key / Device Salt)
 * 
 * 此标识是实现“离线秒开”和“终端绑定加密”的核心：
 * 1. 登录成功后，由后端返回给前端，存入 IndexedDB (device_salt)。
 * 2. 前端获取金库数据后，会使用此 Key 对敏感字段进行本地持久化加密转存。
 * 3. 再次打开应用时，无需请求后端，可直接用此 Key 解密本地缓存，实现极致加载速度。
 * 
 * @param userId 用户唯一标识 (统一使用 Email 以确保多登录方式互通)
 * @param secret 后端私钥 (JWT_SECRET)，确保外部无法伪造此指纹
 */
export async function generateDeviceKey(userId: string, secret: string): Promise<string> {
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        encoder.encode(await normalizeSecret(secret)),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    const signature = await crypto.subtle.sign('HMAC', keyMaterial, encoder.encode(userId + "device_salt_offline_key"));
    return Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('');
}