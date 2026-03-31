import { BaseOAuthProvider, OAuthUserInfo } from '@/features/auth/providers/baseOAuthProvider';
import { EnvBindings, AppError } from '@/app/config';

export class GoogleProvider extends BaseOAuthProvider {
    readonly id = 'google';
    readonly name = 'Google';
    readonly color = '#33A854';
    readonly icon = 'iconGoogle';
    readonly whitelistFields = ['email']; // Google 主要基于邮箱验证

    constructor(env: EnvBindings) {
        super(env);
    }

    getAuthorizeUrl(state: string) {
        const clientId = this.env.OAUTH_GOOGLE_CLIENT_ID;
        const redirectUri = this.env.OAUTH_GOOGLE_REDIRECT_URI;

        if (!clientId || !redirectUri) {
            throw new AppError('oauth_config_incomplete', 500);
        }

        const params = new URLSearchParams({
            client_id: clientId,
            redirect_uri: redirectUri,
            response_type: 'code',
            scope: 'openid email profile',
            state: state,
            access_type: 'online',
            prompt: 'consent'
        });

        return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` };
    }

    async handleCallback(params: string | URLSearchParams, _codeVerifier?: string): Promise<OAuthUserInfo> {
        const code = typeof params === 'string' ? params : params.get('code');

        if (!code) {
            throw new AppError('oauth_code_missing', 400);
        }

        const clientId = this.env.OAUTH_GOOGLE_CLIENT_ID;
        const clientSecret = this.env.OAUTH_GOOGLE_CLIENT_SECRET;
        const redirectUri = this.env.OAUTH_GOOGLE_REDIRECT_URI;

        if (!clientId || !clientSecret || !redirectUri) {
            throw new AppError('oauth_config_incomplete', 500);
        }

        // 1. Exchange Code for Token
        const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
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
            const errText = await tokenResponse.text();
            throw new AppError(`oauth_token_exchange_failed: Google  | ${tokenResponse.status} - ${errText}`, 502);
        }

        const tokenData: any = await tokenResponse.json();
        const accessToken = tokenData.access_token;

        // 2. Get User Info
        const userResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });

        if (!userResponse.ok) throw new AppError(`oauth_api_error: Google  | ${userResponse.status}`, 502);
        const userData: any = await userResponse.json();

        return {
            id: userData.sub,
            username: userData.name || userData.email.split('@')[0],
            email: userData.email,
            avatar: userData.picture,
            provider: this.id
        };
    }
}