import { BaseOAuthProvider, OAuthUserInfo } from '@/features/auth/providers/baseOAuthProvider';
import { EnvBindings, AppError } from '@/app/config';

export class NodeLocProvider extends BaseOAuthProvider {
    readonly id = 'nodeloc';
    readonly name = 'NodeLoc';
    readonly color = '#475569';
    readonly icon = 'iconNodeloc';
    readonly whitelistFields = ['email'];

    constructor(env: EnvBindings) {
        super(env);
    }

    getAuthorizeUrl(state: string) {
        const clientId = this.env.OAUTH_NODELOC_CLIENT_ID;
        const redirectUri = this.env.OAUTH_NODELOC_REDIRECT_URI;

        if (!clientId || !redirectUri) {
            throw new AppError('oauth_config_incomplete', 500);
        }

        const params = new URLSearchParams({
            client_id: clientId,
            redirect_uri: redirectUri,
            response_type: 'code',
            scope: 'openid profile email',
            state: state
        });

        return { url: `https://www.nodeloc.com/oauth-provider/authorize?${params.toString()}` };
    }

    async handleCallback(params: string | URLSearchParams, _codeVerifier?: string): Promise<OAuthUserInfo> {
        // 兼容处理：如果是 URLSearchParams，提取 code；如果是 string，直接使用
        const code = typeof params === 'string' ? params : params.get('code');

        if (!code) {
            throw new AppError('oauth_code_missing', 400);
        }

        const clientId = this.env.OAUTH_NODELOC_CLIENT_ID;
        const clientSecret = this.env.OAUTH_NODELOC_CLIENT_SECRET;
        const redirectUri = this.env.OAUTH_NODELOC_REDIRECT_URI;

        if (!clientId || !clientSecret || !redirectUri) {
            throw new AppError('oauth_config_incomplete', 500);
        }

        // 1. Exchange Code for Token
        const tokenResponse = await fetch('https://www.nodeloc.com/oauth-provider/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json'
            },
            body: new URLSearchParams({
                client_id: clientId,
                client_secret: clientSecret,
                code: code,
                grant_type: 'authorization_code',
                redirect_uri: redirectUri,
            })
        });

        if (!tokenResponse.ok) {
            throw new AppError(`oauth_token_exchange_failed: NodeLoc  | ${tokenResponse.status}`, 502);
        }

        const tokenData: any = await tokenResponse.json();
        const accessToken = tokenData.access_token;

        // 2. Get User Info (Flarum API)
        const userResponse = await fetch('https://www.nodeloc.com/oauth-provider/userinfo', {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Accept': 'application/json'
            }
        });

        if (!userResponse.ok) throw new AppError(`oauth_api_error: NodeLoc  | ${userResponse.status}`, 502);
        const userData: any = await userResponse.json();

        return {
            id: String(userData.id),
            username: userData.username || userData.name || userData.nickname,
            email: userData.email || '',
            avatar: userData.avatar || userData.avatar_url || userData.avatarUrl || '',
            provider: this.id
        };
    }
}