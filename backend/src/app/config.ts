export const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export const SECURITY_CONFIG = {
    MAX_LOGIN_ATTEMPTS: 5,
    LOCKOUT_TIME: 15 * 60 * 1000,
    JWT_EXPIRY: 24 * 60 * 60, // 24小时
    MAX_INPUT_LENGTH: 100,
    MIN_EXPORT_PASSWORD_LENGTH: 12,
    MAX_OAUTH_ATTEMPTS: 3,
    OAUTH_LOCKOUT_TIME: 10 * 60 * 1000,
    MAX_FILE_SIZE: 10 * 1024 * 1024,
};

// ==========================================
// CSP 内容安全策略配置 (集中管理域名白名单)
// ==========================================
export const CSP_POLICY = {
    // 脚本源: 允许本站、内联脚本(Vue必需) 以及 Cloudflare 统计脚本
    SCRIPTS: [
        "'self'",
        "'unsafe-inline'",
        "'unsafe-eval'",
        "'wasm-unsafe-eval'",
        "https://static.cloudflareinsights.com",
    ],
    // 图片源: 允许本站、GitHub 头像、NodeLoc 头像、WalletConnect 链上资产Logo
    IMAGES: [
        "'self'",
        "data:",
        "blob:",
        "https://avatars.githubusercontent.com",
        "https://t.me", // Telegram User Avatars
        "https://*.telesco.pe", // Telegram Avatar CDN
        "https://www.nodeloc.com",
        "https://lh3.googleusercontent.com", // Google User Avatars
        "https://www.google.com", // Google Favicon API
        "https://*.gstatic.com",  // Google 静态资源 (包括所有 t 系列 CDN)
        "https://icons.bitwarden.net", // Bitwarden Icon API
        "https://favicon.im", // Favicon.im API
        "https://explorer-api.walletconnect.com", // 允许加载各种Web3钱包Logo图库
    ],
    CONNECT: [
        "'self'",
        "https://api.github.com",
        "https://github.com",
        "https://cloudflareinsights.com",
        "https://static.cloudflareinsights.com",
        "https://accounts.google.com",
        "https://www.googleapis.com",
        "https://login.microsoftonline.com",
        "https://graph.microsoft.com",
        "https://openapi.baidu.com",
        "https://pan.baidu.com",
        "https://api.dropboxapi.com",
        "https://content.dropboxapi.com",
        "https://www.dropbox.com",
        // WalletConnect (External) - Only needed if Proxy is OFF
        "wss://relay.walletconnect.com",
        "wss://relay.walletconnect.org",
        "https://rpc.walletconnect.com",
        "https://verify.walletconnect.com",
        "https://verify.walletconnect.org"
    ],
    // 框架源: WalletConnect 防钓鱼 Verify API 必需挂载 iframe
    FRAMES: [
        "'self'",
        "https://verify.walletconnect.com",
        "https://verify.walletconnect.org"
    ],
};

/**
 * 获取根据当前环境配置动态生成的有效 CSP 策略
 */
export const getEffectiveCSP = (env: EnvBindings) => {
    const isProxyOn = env.OAUTH_WALLETCONNECT_SELF_PROXY === 'true';

    // 默认直接克隆原始配置
    const connect = [...CSP_POLICY.CONNECT];
    const frames = [...CSP_POLICY.FRAMES];
    const images = [...CSP_POLICY.IMAGES];

    if (isProxyOn) {
        // 当开启自建代理时，从白名单中剔除所有 WalletConnect 外部域名，强制走 'self'
        const externalWC = [
            "wss://relay.walletconnect.com",
            "wss://relay.walletconnect.org",
            "https://rpc.walletconnect.com",
            "https://verify.walletconnect.com",
            "https://verify.walletconnect.org",
            "https://explorer-api.walletconnect.com"
        ];

        return {
            defaultSrc: ["'self'"],
            scriptSrc: CSP_POLICY.SCRIPTS,
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: images.filter(d => !externalWC.includes(d)),
            connectSrc: connect.filter(d => !externalWC.includes(d)),
            fontSrc: ["'self'", "data:"],
            frameSrc: frames.filter(d => !externalWC.includes(d)),
            workerSrc: ["'self'", "blob:"],
            objectSrc: ["'none'"],
        };
    }

    // 默认模式
    return {
        defaultSrc: ["'self'"],
        scriptSrc: CSP_POLICY.SCRIPTS,
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: images,
        connectSrc: connect,
        fontSrc: ["'self'", "data:"],
        frameSrc: frames,
        workerSrc: ["'self'", "blob:"],
        objectSrc: ["'none'"],
    };
};

// Cloudflare Workers & Node.js 环境变量类型定义
export type EnvBindings = {
    DB: any;
    OAUTH_GITHUB_CLIENT_ID: string;
    OAUTH_GITHUB_CLIENT_SECRET: string;
    OAUTH_GITHUB_REDIRECT_URI: string;
    OAUTH_CLOUDFLARE_CLIENT_ID?: string;
    OAUTH_CLOUDFLARE_CLIENT_SECRET?: string;
    OAUTH_CLOUDFLARE_ORG_DOMAIN?: string; // 例如 https://your-team.cloudflareaccess.com
    OAUTH_CLOUDFLARE_REDIRECT_URI?: string;
    OAUTH_NODELOC_CLIENT_ID?: string;
    OAUTH_NODELOC_CLIENT_SECRET?: string;
    OAUTH_NODELOC_REDIRECT_URI?: string;
    OAUTH_GITEE_CLIENT_ID?: string;
    OAUTH_GITEE_CLIENT_SECRET?: string;
    OAUTH_GITEE_REDIRECT_URI?: string;
    OAUTH_GOOGLE_CLIENT_ID?: string;
    OAUTH_GOOGLE_CLIENT_SECRET?: string;
    OAUTH_GOOGLE_REDIRECT_URI?: string;
    OAUTH_GOOGLE_BACKUP_REDIRECT_URI?: string;
    OAUTH_TELEGRAM_BOT_NAME?: string;
    OAUTH_TELEGRAM_BOT_TOKEN?: string;
    OAUTH_TELEGRAM_BOT_DOMAIN?: string;
    OAUTH_TELEGRAM_WEBHOOK_SECRET?: string;
    OAUTH_MICROSOFT_CLIENT_ID?: string;
    OAUTH_MICROSOFT_CLIENT_SECRET?: string;
    OAUTH_MICROSOFT_BACKUP_REDIRECT_URI?: string;
    OAUTH_BAIDU_CLIENT_ID?: string;
    OAUTH_BAIDU_CLIENT_SECRET?: string;
    OAUTH_BAIDU_BACKUP_REDIRECT_URI?: string;
    OAUTH_DROPBOX_CLIENT_ID?: string;
    OAUTH_DROPBOX_CLIENT_SECRET?: string;
    OAUTH_DROPBOX_BACKUP_REDIRECT_URI?: string;
    OAUTH_ALLOWED_USERS: string;    // 允许登录的 Email 或 Username 白名单 (必填)
    OAUTH_ALLOW_ALL?: string;       // 是否允许所有用户登录 (仅推荐用于测试演示环境)
    JWT_SECRET: string;
    ENCRYPTION_KEY: string;
    OAUTH_WALLETCONNECT_PROJECT_ID?: string;
    OAUTH_WALLETCONNECT_SELF_PROXY?: string; // 'true' or 'false'
    LOG_LEVEL?: string;
    SESSION_TTL_DAYS?: number;
    ENVIRONMENT?: string;
};

// 自定义错误类
export class AppError extends Error {
    statusCode: number;
    constructor(message: string, statusCode = 500) {
        super(message);
        this.name = 'AppError';
        this.statusCode = statusCode;
    }
}