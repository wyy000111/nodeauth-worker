import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import telegramRoutes from '@/features/telegram/telegramRoutes';

// 💡 TDD 技巧：模拟全局 fetch，拦截向 Telegram 服务器的请求
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('Telegram Webhook Routes - Red Phase', () => {
    let app: Hono<any>;
    const MOCK_TOKEN = '123:ABC';

    beforeEach(() => {
        vi.clearAllMocks();
        app = new Hono().route('/api/telegram', telegramRoutes);
    });

    // 🔴 预期红灯：验证 /start 指令带参数的逻辑
    it('should send Login URL when /start state is provided', async () => {
        // 模拟 Telegram 发来的 Webhook Update
        const payload = {
            message: {
                chat: { id: 12345 },
                text: '/start test_state_123'
            }
        };

        const res = await app.request('/api/telegram/webhook', {
            method: 'POST',
            body: JSON.stringify(payload),
            headers: { 'Content-Type': 'application/json' }
        }, {
            OAUTH_TELEGRAM_BOT_TOKEN: MOCK_TOKEN,
            OAUTH_TELEGRAM_BOT_DOMAIN: 'nodeauth.hsiao.nom.za'
        } as any);

        expect(res.status).toBe(200);

        // 验证是否调用了 Telegram API
        expect(mockFetch).toHaveBeenCalled();
        const [url, options] = mockFetch.mock.calls[0];
        expect(url).toContain(`bot${MOCK_TOKEN}/sendMessage`);

        const body = JSON.parse(options.body);
        expect(body.chat_id).toBe(12345);

        const loginUrl = body.reply_markup.inline_keyboard[0][0].login_url.url;
        expect(loginUrl).toContain('https://nodeauth.hsiao.nom.za/callback/telegram');
        expect(loginUrl).toContain('state=test_state_123');
    });

    // 🔴 预期红灯：验证无参数的 /start
    it('should send welcome message for plain /start', async () => {
        const payload = {
            message: { chat: { id: 999 }, text: '/start' }
        };

        await app.request('/api/telegram/webhook', {
            method: 'POST',
            body: JSON.stringify(payload),
            headers: { 'Content-Type': 'application/json' }
        }, { OAUTH_TELEGRAM_BOT_TOKEN: MOCK_TOKEN } as any);

        expect(mockFetch).toHaveBeenCalled();
        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.text).toContain('欢迎使用');
    });

    // 🔴 预期红灯：验证 Token 缺失处理
    it('should return 500 if token is not configured', async () => {
        const res = await app.request('/api/telegram/webhook', {
            method: 'POST',
            body: JSON.stringify({ message: { text: 'hi' } })
        }, {} as any); // 给空 env

        expect(res.status).toBe(500);
    });
});
