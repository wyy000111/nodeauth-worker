import { BaseOAuthProvider, OAuthUserInfo } from '@/features/auth/providers/baseOAuthProvider';
import { EnvBindings, AppError } from '@/app/config';

export class GitHubProvider extends BaseOAuthProvider {
    readonly id = 'github';
    readonly name = 'GitHub';
    readonly color = '#24292e';
    readonly icon = 'iconGithub';
    readonly whitelistFields = ['email'];

    constructor(env: EnvBindings) {
        super(env);
    }

    getAuthorizeUrl(state: string) {
        const clientId = this.env.OAUTH_GITHUB_CLIENT_ID;
        const redirectUri = this.env.OAUTH_GITHUB_REDIRECT_URI;

        const params = new URLSearchParams({
            client_id: clientId,
            redirect_uri: redirectUri,
            state: state,
            scope: 'read:user user:email' // 显式请求 Email 权限
        });

        return { url: `https://github.com/login/oauth/authorize?${params.toString()}` };
    }

    async handleCallback(params: string | URLSearchParams, _codeVerifier?: string): Promise<OAuthUserInfo> {
        // 兼容处理：如果是 URLSearchParams，提取 code；如果是 string，直接使用
        const code = typeof params === 'string' ? params : params.get('code');

        if (!code) {
            throw new AppError('oauth_code_missing', 400);
        }

        // 1. 使用 Code 换取 Access Token
        const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json',
                'User-Agent': 'NodeAuth-Backend/1.0'
            },
            body: new URLSearchParams({
                client_id: this.env.OAUTH_GITHUB_CLIENT_ID,
                client_secret: this.env.OAUTH_GITHUB_CLIENT_SECRET,
                code: code,
                redirect_uri: this.env.OAUTH_GITHUB_REDIRECT_URI,
            })
        });

        if (!tokenResponse.ok) {
            throw new AppError(`oauth_token_exchange_failed: GitHub  | ${tokenResponse.status}`, 502);
        }

        const tokenData: any = await tokenResponse.json();

        if (tokenData.error) {
            throw new AppError(`oauth_token_exchange_failed: GitHub | ${tokenData.error_description || tokenData.error}`, 400);
        }

        const accessToken = tokenData.access_token;

        // 2. 获取用户信息
        const userResponse = await fetch('https://api.github.com/user', {
            headers: {
                'Authorization': `token ${accessToken}`,
                'Accept': 'application/json',
                'User-Agent': 'NodeAuth-Backend/1.0'
            }
        });

        if (!userResponse.ok) throw new AppError(`oauth_api_error: GitHub  | ${userResponse.status}`, 502);
        const userData: any = await userResponse.json();

        // 3. 补充获取 Email (如果公开资料中没有)
        let email = userData.email;
        if (!email) {
            try {
                const emailRes = await fetch('https://api.github.com/user/emails', {
                    headers: { 'Authorization': `token ${accessToken}`, 'User-Agent': 'NodeAuth-Backend/1.0' }
                });
                const emails: any[] = await emailRes.json();
                email = emails.find(e => e.primary && e.verified)?.email || emails.find(e => e.verified)?.email;
            } catch (e) { /* ignore */ }
        }

        // 4. 映射到标准结构
        return {
            id: String(userData.id),
            username: userData.login || userData.username,
            email: email || '',
            avatar: userData.avatar_url,
            provider: this.id
        };
    }
}