import { BaseOAuthProvider, OAuthUserInfo } from '@/features/auth/providers/baseOAuthProvider';
import { EnvBindings, AppError } from '@/app/config';

// Move to crypto.ts
// PKCE 辅助函数
function base64UrlEncode(str: Uint8Array): string {
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
// Move to crypto.ts
async function generatePKCE() {
    const verifierBytes = new Uint8Array(32);
    crypto.getRandomValues(verifierBytes);
    const verifier = base64UrlEncode(verifierBytes);

    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    const hash = await crypto.subtle.digest('SHA-256', data);
    const challenge = base64UrlEncode(new Uint8Array(hash));

    return { verifier, challenge };
}

export class CloudflareAccessProvider extends BaseOAuthProvider {
    readonly id = 'cloudflare';
    readonly name = 'Cloudflare Access';
    readonly color = '#F38020';
    readonly icon = 'iconCloudflare';
    readonly whitelistFields = ['email']; // Cloudflare Access 主要基于邮箱验证

    constructor(env: EnvBindings) {
        super(env);
    }

    // 提取公共方法处理 URL 标准化
    private getBaseUrl(): string {
        const orgDomain = this.env.OAUTH_CLOUDFLARE_ORG_DOMAIN;
        if (!orgDomain) {
            throw new AppError('Cloudflare Access 配置不完整：缺少 OAUTH_CLOUDFLARE_ORG_DOMAIN', 500);
        }

        let baseUrl = orgDomain.replace(/\/$/, '');
        if (!baseUrl.startsWith('http')) {
            baseUrl = `https://${baseUrl}`;
        }
        return baseUrl;
    }

    async getAuthorizeUrl(state: string) {
        const clientId = this.env.OAUTH_CLOUDFLARE_CLIENT_ID;
        const redirectUri = this.env.OAUTH_CLOUDFLARE_REDIRECT_URI;

        if (!clientId || !redirectUri) {
            throw new AppError('Cloudflare Access 配置不完整', 500);
        }

        const baseUrl = this.getBaseUrl();
        const { verifier, challenge } = await generatePKCE();

        const params = new URLSearchParams({
            client_id: clientId,
            redirect_uri: redirectUri,
            response_type: 'code',
            scope: 'openid profile email',
            state: state,
            code_challenge: challenge,
            code_challenge_method: 'S256'
        });

        const url = `${baseUrl}/cdn-cgi/access/sso/oidc/${clientId}/authorization?${params.toString()}`;
        return { url, codeVerifier: verifier };
    }

    async handleCallback(params: string | URLSearchParams, codeVerifier?: string): Promise<OAuthUserInfo> {
        // 兼容处理：如果是 URLSearchParams，提取 code；如果是 string，直接使用
        const code = typeof params === 'string' ? params : params.get('code');

        if (!code) {
            throw new AppError('oauth_code_missing', 400);
        }

        const clientId = this.env.OAUTH_CLOUDFLARE_CLIENT_ID;
        const clientSecret = this.env.OAUTH_CLOUDFLARE_CLIENT_SECRET;
        const redirectUri = this.env.OAUTH_CLOUDFLARE_REDIRECT_URI;

        if (!clientId || !clientSecret || !redirectUri) {
            throw new AppError('Cloudflare Access 配置不完整', 500);
        }

        const baseUrl = this.getBaseUrl();

        // 1. Exchange code for token
        const tokenResponse = await fetch(`${baseUrl}/cdn-cgi/access/sso/oidc/${clientId}/token`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                client_id: clientId,
                client_secret: clientSecret,
                code: code,
                code_verifier: codeVerifier || '', // PKCE 必需参数
                redirect_uri: redirectUri,
                grant_type: 'authorization_code',
            })
        });

        if (!tokenResponse.ok) {
            // 增加更详细的错误日志，方便调试
            const errorText = await tokenResponse.text();
            console.error(`Cloudflare Access Token Error: ${tokenResponse.status} - ${errorText}`);
            throw new AppError(`oauth_token_exchange_failed: Cloudflare Access  | ${tokenResponse.status}`, 502);
        }

        const tokenData: any = await tokenResponse.json();
        const accessToken = tokenData.access_token;

        // 2. Get User Info (OIDC Standard)
        // Cloudflare Access 的 ID Token 其实已经包含了 email，但为了保险我们请求 userinfo
        const userResponse = await fetch(`${baseUrl}/cdn-cgi/access/sso/oidc/${clientId}/userinfo`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        if (!userResponse.ok) throw new AppError(`oauth_api_error: Cloudflare Access  | ${userResponse.status}`, 502);
        const userData: any = await userResponse.json();

        return {
            id: userData.sub, // Cloudflare 用户唯一 ID
            username: userData.preferred_username || userData.email.split('@')[0],
            email: userData.email,
            avatar: '', // Cloudflare Access 通常不提供头像
            provider: this.id
        };
    }
}