import { BaseOAuthProvider, OAuthUserInfo } from '@/features/auth/providers/baseOAuthProvider';
import { EnvBindings, AppError } from '@/app/config';

export class GiteeProvider extends BaseOAuthProvider {
    readonly id = 'gitee';
    readonly name = 'Gitee';
    readonly color = '#C71D23';
    readonly icon = 'iconGitee';
    readonly whitelistFields = ['email'];

    constructor(env: EnvBindings) {
        super(env);
    }

    getAuthorizeUrl(state: string) {
        const clientId = this.env.OAUTH_GITEE_CLIENT_ID;
        const redirectUri = this.env.OAUTH_GITEE_REDIRECT_URI;

        if (!clientId || !redirectUri) {
            throw new AppError('oauth_config_incomplete', 500);
        }

        const params = new URLSearchParams({
            client_id: clientId,
            redirect_uri: redirectUri,
            response_type: 'code',
            scope: 'user_info emails',
            state: state
        });

        return { url: `https://gitee.com/oauth/authorize?${params.toString()}` };
    }

    async handleCallback(params: string | URLSearchParams, _codeVerifier?: string): Promise<OAuthUserInfo> {
        // 兼容处理：如果是 URLSearchParams，提取 code；如果是 string，直接使用
        const code = typeof params === 'string' ? params : params.get('code');

        if (!code) {
            throw new AppError('oauth_code_missing', 400);
        }

        const clientId = this.env.OAUTH_GITEE_CLIENT_ID;
        const clientSecret = this.env.OAUTH_GITEE_CLIENT_SECRET;
        const redirectUri = this.env.OAUTH_GITEE_REDIRECT_URI;

        if (!clientId || !clientSecret || !redirectUri) {
            throw new AppError('oauth_config_incomplete', 500);
        }

        // 1. Exchange Code for Token
        const tokenResponse = await fetch('https://gitee.com/oauth/token', {
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
            throw new AppError(`oauth_token_exchange_failed: Gitee  | ${tokenResponse.status}`, 502);
        }

        const tokenData: any = await tokenResponse.json();
        const accessToken = tokenData.access_token;

        // 2. Get User Info
        const userResponse = await fetch(`https://gitee.com/api/v5/user?access_token=${accessToken}`);
        if (!userResponse.ok) throw new AppError(`oauth_api_error: Gitee  | ${userResponse.status}`, 502);
        const userData: any = await userResponse.json();

        // 3. Get Email (if not in basic profile)
        let email = userData.email;
        if (!email) {
            try {
                const emailRes = await fetch(`https://gitee.com/api/v5/emails?access_token=${accessToken}`);
                if (emailRes.ok) {
                    const emails: any[] = await emailRes.json();
                    email = emails.find(e => e.scope && e.scope.includes('primary'))?.email || emails[0]?.email;
                }
            } catch (e) { /* ignore */ }
        }

        return {
            id: String(userData.id),
            username: userData.login || userData.name,
            email: email || '',
            avatar: userData.avatar_url || '',
            provider: this.id
        };
    }
}