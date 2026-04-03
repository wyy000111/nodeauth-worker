/**
 * NodeAuth 环境变量安全加密工具 (Production Ready)
 * 算法: AES-GCM-256 + PBKDF2 (SHA-256)
 */
import { webcrypto } from 'node:crypto';

// 兼容全局 crypto 对象
const crypto = webcrypto;

// 必须与业务代码中的盐值完全一致
const SALT = new TextEncoder().encode('env_key_derivation_salt');

/**
 * 派生密钥逻辑 (对齐业务代码)
 */
async function getDerivedKey(password) {
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        encoder.encode(password),
        { name: 'PBKDF2' },
        false,
        ['deriveKey']
    );
    return crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: SALT,
            iterations: 100000,
            hash: 'SHA-256'
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
    );
}

/**
 * 加密主函数
 */
async function encrypt(plainText, jwtSecret) {
    try {
        const key = await getDerivedKey(jwtSecret);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encoder = new TextEncoder();

        const encrypted = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            key,
            encoder.encode(plainText)
        );

        const encryptedArray = new Uint8Array(encrypted);
        // GCM 模式密文最后 16 字节是 Tag
        const ciphertext = encryptedArray.slice(0, encryptedArray.length - 16);
        const tag = encryptedArray.slice(encryptedArray.length - 16);

        const b64 = (arr) => Buffer.from(arr).toString('base64');

        const result = `aes:${b64(iv)}:${b64(tag)}:${b64(ciphertext)}`;

        console.log("\n" + "=".repeat(50));
        console.log("🔐 Encryption Successful!");
        console.log("=".repeat(50));
        console.log(`\nInput Text:  ${plainText}`);
        console.log(`Root Key:    ${jwtSecret}`);
        console.log(`\nCopy this to your .env or docker-compose.yml:`);
        console.log(`\x1b[32m${result}\x1b[0m\n`);
        console.log("=".repeat(50) + "\n");
    } catch (e) {
        console.error("\n❌ Encryption Failed:", e.message);
    }
}

// 获取命令行参数
const [, , text, secret] = process.argv;

if (!text || !secret) {
    console.log(`
\x1b[1mNodeAuth Env Encryptor\x1b[0m
Usage: 
  node scripts/encrypt-env.js "<plain_text>" "<jwt_secret>"

Example:
  node scripts/encrypt-env.js "my_db_password" "base64:xxx..."
`);
} else {
    encrypt(text, secret);
}
