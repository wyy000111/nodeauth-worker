import { EnvBindings } from '@/app/config';

export interface OAuthUserInfo {
    id: string;
    email: string;
    username: string;
    avatar?: string;
    provider: string; // 记录来源，如 'github'
}

export abstract class BaseOAuthProvider {
    protected env: EnvBindings;

    constructor(env: EnvBindings) {
        this.env = env;
    }
    abstract readonly id: string;
    abstract readonly name: string;
    abstract readonly color: string; // 按钮背景色
    abstract readonly icon: string; // 前端 Vue 图标组件名，如 'iconGithub'
    abstract readonly whitelistFields: string[]; // 新增：定义该 Provider 支持哪些白名单字段 (如 ['email', 'username'])

    // 1. 获取授权跳转链接
    // 返回对象包含 url 和可选的 codeVerifier (用于 PKCE)
    abstract getAuthorizeUrl(state: string): Promise<{ url: string, codeVerifier?: string }> | { url: string, codeVerifier?: string };

    // 2. 处理回调：Code -> Token -> UserInfo
    // 修改：支持传入 URLSearchParams (Telegram 需要验证所有参数) 或 string (标准 OAuth code)
    abstract handleCallback(params: string | URLSearchParams, codeVerifier?: string): Promise<OAuthUserInfo>;
}