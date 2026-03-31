import { describe, it, expect, beforeEach } from 'vitest';
import { TelegramProvider } from '@/features/auth/providers/telegramProvider';

describe('TelegramProvider - Security Validation', () => {
    let provider: TelegramProvider;
    const MOCK_BOT_TOKEN = '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11';

    beforeEach(() => {
        provider = new TelegramProvider({ OAUTH_TELEGRAM_BOT_TOKEN: MOCK_BOT_TOKEN } as any);
    });

    // 辅助函数：模拟 Telegram 官方签名生成逻辑
    async function generateValidTelegramHash(data: Record<string, string>, token: string) {
        const dataCheckArr = Object.entries(data)
            .filter(([key]) => key !== 'hash')
            .map(([key, value]) => `${key}=${value}`)
            .sort();
        const dataCheckString = dataCheckArr.join('\n');

        const encoder = new TextEncoder();
        const secretKeyData = await crypto.subtle.digest('SHA-256', encoder.encode(token));
        const key = await crypto.subtle.importKey(
            'raw', secretKeyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
        );
        const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(dataCheckString));

        return Array.from(new Uint8Array(signature))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    }

    it('should pass with a valid signature and current timestamp', async () => {
        const authDate = Math.floor(Date.now() / 1000).toString();
        const testData = {
            id: '12345',
            username: 'test_user',
            first_name: 'Test',
            auth_date: authDate
        };

        const hash = await generateValidTelegramHash(testData, MOCK_BOT_TOKEN);
        const params = new URLSearchParams({ ...testData, hash });

        const userInfo = await provider.handleCallback(params);
        expect(userInfo.id).toBe('12345');
        expect(userInfo.username).toBe('test_user');
    });

    // 🔴 预期红灯：篡改数据
    it('should throw "telegram_signature_failed" if data is tampered', async () => {
        const testData = { id: '12345', auth_date: Math.floor(Date.now() / 1000).toString() };
        const hash = await generateValidTelegramHash(testData, MOCK_BOT_TOKEN);

        // 恶意篡改：改变 ID
        const params = new URLSearchParams({ id: '99999', auth_date: testData.auth_date, hash });

        await expect(provider.handleCallback(params))
            .rejects
            .toThrowError(/telegram_signature_failed/);
    });

    // 🔴 预期红灯：过期登录
    it('should throw "telegram_login_expired" if auth_date is too old', async () => {
        // 两天前 (86400 * 2)
        const oldDate = (Math.floor(Date.now() / 1000) - 172800).toString();
        const testData = { id: '12345', auth_date: oldDate };
        const hash = await generateValidTelegramHash(testData, MOCK_BOT_TOKEN);

        const params = new URLSearchParams({ ...testData, hash });

        await expect(provider.handleCallback(params))
            .rejects
            .toThrowError(/telegram_login_expired/);
    });

    it('should throw "telegram_missing_hash" if hash is absent', async () => {
        const params = new URLSearchParams({ id: '123' });
        await expect(provider.handleCallback(params)).rejects.toThrowError(/telegram_missing_hash/);
    });
});
