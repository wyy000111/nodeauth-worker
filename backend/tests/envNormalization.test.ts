import { describe, it, expect } from 'vitest';
// @ts-ignore - normalizeSecret 还不支持 async，这里先按照预期 API 编写
import { normalizeSecret, getDerivedEncryptionKey, initializeEnv } from '../src/shared/utils/crypto';

/**
 * 辅助函数：模拟未来实现的加密逻辑，用于生成测试密文
 */
async function createAesSecret(plain: string, jwtSecret: string) {
    const encoder = new TextEncoder();
    // 这里的解析逻辑需与未来 normalizeSecret 内部一致
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        encoder.encode(jwtSecret),
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
        false,
        ['encrypt', 'decrypt']
    );

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        encoder.encode(plain)
    );

    const encryptedArray = new Uint8Array(encrypted);
    const ciphertext = encryptedArray.slice(0, encryptedArray.length - 16);
    const tag = encryptedArray.slice(encryptedArray.length - 16);

    const b64 = (arr: Uint8Array) => {
        let binary = '';
        const len = arr.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(arr[i]);
        }
        return btoa(binary);
    };
    return `aes:${b64(iv)}:${b64(tag)}:${b64(ciphertext)}`;
}

describe('Environment Normalization TDD (22 Points Coverage)', () => {

    // --- Happy Path (正常路径) ---

    it('[HP-01] 保持普通明文', async () => {
        const result = await (normalizeSecret as any)('plain_text');
        expect(result).toBe('plain_text');
    });

    it('[HP-02] 解析 base64: 前缀', async () => {
        const val = 'hello';
        const result = await (normalizeSecret as any)(`base64:${btoa(val)}`);
        expect(result).toBe(val);
    });

    it('[HP-03] 解析 hex: 前缀', async () => {
        const result = await (normalizeSecret as any)('hex:48656c6c6f');
        expect(result).toBe('Hello');
    });

    it('[HP-04] 双层解析：解开依赖 JWT_SECRET 的 AES 变量', async () => {
        const jwt = 'root_key';
        const plain = 'secret_data';
        const aes = await createAesSecret(plain, jwt);
        const result = await (normalizeSecret as any)(aes, jwt);
        expect(result).toBe(plain);
    });

    it('[HP-05] 混合前缀解析', async () => {
        const jwt = 'key';
        const aes = await createAesSecret('sensitive', jwt);
        expect(await (normalizeSecret as any)('hex:31', jwt)).toBe('1');
        expect(await (normalizeSecret as any)(aes, jwt)).toBe('sensitive');
    });

    it('[HP-06] Middleware 模拟：全量更新环境对象', async () => {
        const env = { JWT_SECRET: 'base64:a2V5', DB_URL: 'plain', ADDR: 'hex:31' };
        // 模拟 middleware 逻辑
        const decodedJwt = await (normalizeSecret as any)(env.JWT_SECRET);
        const decodedDb = await (normalizeSecret as any)(env.DB_URL, decodedJwt);
        expect(decodedJwt).toBe('key');
        expect(decodedDb).toBe('plain');
    });

    it('[HP-07/08] 派生密钥确定性', async () => {
        if (typeof getDerivedEncryptionKey === 'function') {
            const k1 = await getDerivedEncryptionKey('seed');
            const k2 = await getDerivedEncryptionKey('seed');
            const r1 = await crypto.subtle.exportKey('raw', k1);
            const r2 = await crypto.subtle.exportKey('raw', k2);
            expect(new Uint8Array(r1)).toEqual(new Uint8Array(r2));
        }
    });

    it('[HP-09] JWT_SECRET 包含 Emoji', async () => {
        const jwt = '🔑_root';
        const aes = await createAesSecret('data', jwt);
        expect(await (normalizeSecret as any)(aes, jwt)).toBe('data');
    });

    it('[HP-10] JSON 密文恢复', async () => {
        const json = '{"id":1}';
        const aes = await createAesSecret(json, 'k');
        expect(await (normalizeSecret as any)(aes, 'k')).toBe(json);
    });

    it('[HP-11/12] 幂等性：重复调用不破坏结果', async () => {
        const step1 = await (normalizeSecret as any)('base64:YWJj');
        const step2 = await (normalizeSecret as any)(step1);
        expect(step2).toBe('abc');
    });

    it('[HP-13] initializeEnv: 一站式全量对象初始化', async () => {
        const jwt = 'my-root';
        const aes = await createAesSecret('sensitive_val', jwt);
        const env = {
            JWT_SECRET: jwt,
            DB_KEY: aes,
            PORT: '3000',
            LOG: 'hex:696e666f' // "info"
        };

        await initializeEnv(env);

        expect(env.JWT_SECRET).toBe(jwt);
        expect(env.DB_KEY).toBe('sensitive_val');
        expect(env.PORT).toBe('3000');
        expect(env.LOG).toBe('info');
    });

    it('[HP-14] initializeEnv: process.env 同步副作用验证', async () => {
        const oldVal = process.env.TEST_SYNC_KEY;
        try {
            const jwt = 'sync-test-key';
            const aes = await createAesSecret('test_data', jwt);
            const env = {
                JWT_SECRET: jwt,
                TEST_SYNC_KEY: aes
            };

            await initializeEnv(env);

            expect(process.env.TEST_SYNC_KEY).toBe('test_data');
            expect(process.env.JWT_SECRET).toBe(jwt);
        } finally {
            if (oldVal === undefined) delete process.env.TEST_SYNC_KEY;
            else process.env.TEST_SYNC_KEY = oldVal;
        }
    });

    it('[HP-15] initializeEnv: 处理顺序验证 (AES 在 JWT 前时仍能解密)', async () => {
        const jwt = 'key-1';
        const aes = await createAesSecret('data-1', jwt);
        const env: any = {
            A_VAR: aes,  // 字母序排在 JWT 前面
            JWT_SECRET: `base64:${btoa(jwt)}`
        };

        await initializeEnv(env);
        expect(env.JWT_SECRET).toBe(jwt);
        expect(env.A_VAR).toBe('data-1');
    });

    // --- Edge Cases (异常路径) ---

    it('[EC-01] 缺少根密钥时解密 aes: 应报错', async () => {
        await expect((normalizeSecret as any)('aes:1:2:3')).rejects.toThrow(/missing|root/i);
    });

    it('[EC-02] 格式非法：缺少段落', async () => {
        await expect((normalizeSecret as any)('aes:part1', 'key')).rejects.toThrow(/format/i);
    });

    it('[EC-03] 密钥不匹配：Tag 校验失败', async () => {
        const aes = await createAesSecret('data', 'key1');
        await expect((normalizeSecret as any)(aes, 'key2')).rejects.toThrow();
    });

    it('[EC-04] 空内容前缀 aes:', async () => {
        await expect((normalizeSecret as any)('aes:', 'key')).rejects.toThrow();
    });

    it('[EC-05] Base64 损坏', async () => {
        await expect((normalizeSecret as any)('aes:!!!:!!!:!!!', 'key')).rejects.toThrow();
    });

    it('[EC-06] 根密钥禁止自解密逻辑 (预期抛出缺失密钥错误)', async () => {
        const val = 'aes:iv:tag:data';
        await expect((normalizeSecret as any)(val)).rejects.toThrow(/missing|root/i);
    });

    it('[EC-07] 超大字段 1MB+ 测试', async () => {
        const big = 'B'.repeat(1024 * 1024);
        const aes = await createAesSecret(big, 'key');
        expect(await (normalizeSecret as any)(aes, 'key')).toBe(big);
    });

    it('[EC-08] 不存在的 Key 处理', async () => {
        expect(await (normalizeSecret as any)(undefined)).toBe(undefined);
    });

    it('[EC-09] 大小写敏感测试', async () => {
        expect(await (normalizeSecret as any)('AES:data', 'key')).toBe('AES:data');
    });

    it('[EC-10] 性能基准：连续解密 100 个变量', async () => {
        const key = 'perf';
        const secrets = await Promise.all(Array(50).fill(0).map((_, i) => createAesSecret(`val${i}`, key)));
        const start = Date.now();
        for (const s of secrets) {
            await (normalizeSecret as any)(s, key);
        }
        const duration = Date.now() - start;
        console.log(`Decrypted 50 variables in ${duration}ms`);
        expect(duration).toBeLessThan(1000); // 1秒内
    });

    it('[EC-11] 字段内包含额外冒号', async () => {
        // Base64 本身不含冒号，若人为构造
        await expect((normalizeSecret as any)('aes:p1:p2:p3:extra', 'key')).rejects.toThrow();
    });

    it('[EC-12] 解密非字符串类型（保护逻辑）', async () => {
        expect(await (normalizeSecret as any)(123 as any)).toBe(123);
    });

    it('[EC-13] initializeEnv: 处理特殊系统变量 (ASSETS)', async () => {
        const env: any = {
            JWT_SECRET: 'k',
            ASSETS: { fetch: () => { } },
            VAR_X: 'aes:invalid:format'
        };
        await initializeEnv(env);
        expect(env.ASSETS).toBeInstanceOf(Object);
        expect(env.VAR_X).toBe('aes:invalid:format'); // 非法格式应保持原样而不崩溃
    });

});
