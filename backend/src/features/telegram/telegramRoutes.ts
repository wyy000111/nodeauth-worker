import { Hono } from 'hono';
import { EnvBindings } from '@/app/config';

const telegram = new Hono<{ Bindings: EnvBindings }>();

// 处理 Telegram Webhook
telegram.post('/webhook', async (c) => {
    const token = c.env.OAUTH_TELEGRAM_BOT_TOKEN;
    if (!token) return c.text('Bot Token not configured', 500);

    // 1. 安全校验 (可选，建议在 setWebhook 时设置 secret_token)
    // const secretToken = c.req.header('X-Telegram-Bot-Api-Secret-Token');
    // if (secretToken !== c.env.TELEGRAM_WEBHOOK_SECRET) return c.text('Unauthorized', 403);

    const update = await c.req.json();

    // 只处理 Message 类型的 Update
    if (!update.message) return c.json({ ok: true });

    const chatId = update.message.chat.id;
    const text = update.message.text || '';

    // 2. 处理 /start 命令
    if (text.startsWith('/start')) {
        const args = text.split(' ');
        const state = args[1];

        if (!state) {
            await sendTelegramMessage(token, chatId, '欢迎使用 NodeAuth Bot！\n请从网页端发起登录请求。');
            return c.json({ ok: true });
        }

        // 3. 构造 Login URL 按钮
        // ⚠️ 关键：Login URL 必须是 HTTPS 且域名与在 Botfather 处设置的域一致
        let origin: string;
        if (c.env.OAUTH_TELEGRAM_BOT_DOMAIN) {
            origin = `https://${c.env.OAUTH_TELEGRAM_BOT_DOMAIN.replace(/^https?:\/\//, '')}`;
        } else {
            const url = new URL(c.req.url);
            origin = `${url.protocol}//${url.hostname}`;
            // 生产环境下强制升级到 https
            if (!origin.startsWith('https://') && !origin.includes('localhost')) {
                origin = origin.replace('http:', 'https:');
            }
        }

        const callbackUrl = `${origin}/callback/telegram?state=${state}`;

        await sendTelegramMessage(token, chatId, '请点击下方按钮完成登录验证：', {
            inline_keyboard: [[
                {
                    text: '🔐 确认登录',
                    login_url: { url: callbackUrl, request_write_access: true }
                }
            ]]
        });
    }

    return c.json({ ok: true });
});

async function sendTelegramMessage(token: string, chatId: number, text: string, replyMarkup?: any) {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chat_id: chatId,
            text: text,
            reply_markup: replyMarkup
        })
    });
}

export default telegram;