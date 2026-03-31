import { BaseOAuthProvider, OAuthUserInfo } from '@/features/auth/providers/baseOAuthProvider';
import { EnvBindings, AppError } from '@/app/config';

export class TelegramProvider extends BaseOAuthProvider {
    readonly id = 'telegram';
    readonly name = 'Telegram';
    readonly color = '#54a9eb';
    readonly icon = 'iconTelegram';
    readonly whitelistFields = ['id']; // Telegram 不保证提供 email

    constructor(env: EnvBindings) {
        super(env);
    }

    // 修改为 Deep Link 模式：生成跳转到 Bot 的链接，并携带 state 参数
    // 例如：https://t.me/MyAuthBot?start=state_value
    getAuthorizeUrl(state: string) {
        const botName = this.env.OAUTH_TELEGRAM_BOT_NAME;
        if (!botName) throw new AppError('telegram_missing_bot_name', 500);

        // 注意：Telegram start 参数只允许 [A-Za-z0-9_-]，UUID 通常符合，但最好移除连字符以防万一
        // 这里我们直接使用 state，但在前端生成 state 时最好确保它是 URL 安全的
        return { url: `https://t.me/${botName}?start=${state}` };
    }

    async handleCallback(params: string | URLSearchParams, _codeVerifier?: string): Promise<OAuthUserInfo> {
        if (typeof params === 'string') {
            throw new AppError('telegram_missing_query', 400);
        }

        const botToken = this.env.OAUTH_TELEGRAM_BOT_TOKEN;
        if (!botToken) throw new AppError('telegram_missing_bot_token', 500);

        // 1. 提取并验证必要字段
        const hash = params.get('hash');
        if (!hash) throw new AppError('telegram_missing_hash', 400);

        const dataCheckArr: string[] = [];
        const allowedKeys = ['auth_date', 'first_name', 'id', 'last_name', 'photo_url', 'username'];

        // 2. 构造 data-check-string (按字母顺序排序 key=value)
        params.forEach((value, key) => {
            if (key !== 'hash' && allowedKeys.includes(key)) {
                dataCheckArr.push(`${key}=${value}`);
            }
        });
        dataCheckArr.sort();
        const dataCheckString = dataCheckArr.join('\n');

        // 3. 验证签名 (HMAC-SHA256)
        // Secret key 是 Bot Token 的 SHA256 哈希
        const encoder = new TextEncoder();
        const secretKeyData = await crypto.subtle.digest('SHA-256', encoder.encode(botToken));

        const key = await crypto.subtle.importKey(
            'raw',
            secretKeyData,
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['verify']
        );

        const signature = this.hexToBuf(hash);
        const isValid = await crypto.subtle.verify(
            'HMAC',
            key,
            signature,
            encoder.encode(dataCheckString)
        );

        if (!isValid) {
            throw new AppError('telegram_signature_failed', 403);
        }

        // 4. 检查时效性 (Telegram 建议检查 auth_date)
        const authDate = parseInt(params.get('auth_date') || '0');
        const now = Math.floor(Date.now() / 1000);
        if (now - authDate > 86400) { // 24小时过期
            throw new AppError('telegram_login_expired', 401);
        }

        // 5. 返回用户信息
        // 注意：Telegram 默认不返回 Email，除非使用 Passport (复杂)
        // 这里我们只能依赖 ID 或 Username
        return {
            id: params.get('id')!,
            username: params.get('username') || `tg_user_${params.get('id')}`,
            email: '', // Telegram 登录通常没有 Email
            avatar: params.get('photo_url') || undefined,
            provider: this.id
        };
    }

    private hexToBuf(hex: string): ArrayBuffer {
        const view = new Uint8Array(hex.length / 2);
        for (let i = 0; i < hex.length; i += 2) {
            view[i / 2] = parseInt(hex.substring(i, i + 2), 16);
        }
        return view.buffer;
    }
}