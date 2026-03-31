import { EnvBindings, AppError } from '@/app/config';
import { BaseOAuthProvider } from '@/features/auth/providers/baseOAuthProvider';
import { GitHubProvider } from '@/features/auth/providers/githubProvider';
import { CloudflareAccessProvider } from '@/features/auth/providers/cloudflareAccessProvider';
import { NodeLocProvider } from '@/features/auth/providers/nodeLocProvider';
import { GiteeProvider } from '@/features/auth/providers/giteeProvider';
import { TelegramProvider } from '@/features/auth/providers/telegramProvider';
import { GoogleProvider } from '@/features/auth/providers/googleProvider';

export function getOAuthProvider(providerId: string, env: EnvBindings): BaseOAuthProvider {
    switch (providerId.toLowerCase()) {
        case 'github':
            return new GitHubProvider(env);
        case 'gitee':
            return new GiteeProvider(env);
        case 'cloudflare':
            return new CloudflareAccessProvider(env);
        case 'nodeloc':
            return new NodeLocProvider(env);
        case 'telegram':
            return new TelegramProvider(env);
        case 'google':
            return new GoogleProvider(env);
        default:
            throw new AppError(`unsupported_provider: ${providerId}`, 400);
    }
}

export function getAvailableProviders(env: EnvBindings) {
    const providers = [];

    const githubProvider = new GitHubProvider(env);
    const cloudflareProvider = new CloudflareAccessProvider(env);
    const nodelocProvider = new NodeLocProvider(env);
    const giteeProvider = new GiteeProvider(env);
    const telegramProvider = new TelegramProvider(env);
    const googleProvider = new GoogleProvider(env);

    if (env.OAUTH_GOOGLE_CLIENT_ID && env.OAUTH_GOOGLE_CLIENT_SECRET) {
        providers.push({
            id: googleProvider.id,
            name: googleProvider.name,
            icon: googleProvider.icon,
            color: googleProvider.color,
        });
    }

    if (env.OAUTH_GITHUB_CLIENT_ID && env.OAUTH_GITHUB_CLIENT_SECRET) {
        providers.push({
            id: githubProvider.id,
            name: githubProvider.name,
            icon: githubProvider.icon,
            color: githubProvider.color
        });
    }

    if (env.OAUTH_TELEGRAM_BOT_TOKEN && env.OAUTH_TELEGRAM_BOT_NAME) {
        providers.push({
            id: telegramProvider.id,
            name: telegramProvider.name,
            icon: telegramProvider.icon,
            color: telegramProvider.color,
        });
    }

    if (env.OAUTH_CLOUDFLARE_CLIENT_ID && env.OAUTH_CLOUDFLARE_CLIENT_SECRET) {
        providers.push({
            id: cloudflareProvider.id,
            name: cloudflareProvider.name,
            icon: cloudflareProvider.icon,
            color: cloudflareProvider.color,
        });
    }

    if (env.OAUTH_GITEE_CLIENT_ID && env.OAUTH_GITEE_CLIENT_SECRET) {
        providers.push({
            id: giteeProvider.id,
            name: giteeProvider.name,
            icon: giteeProvider.icon,
            color: giteeProvider.color,
        });
    }

    if (env.OAUTH_NODELOC_CLIENT_ID && env.OAUTH_NODELOC_CLIENT_SECRET) {
        providers.push({
            id: nodelocProvider.id,
            name: nodelocProvider.name,
            icon: nodelocProvider.icon,
            color: nodelocProvider.color,
        });
    }

    if (env.OAUTH_WALLETCONNECT_PROJECT_ID) {
        providers.push({
            id: 'web3',
            name: 'Web3 Wallet',
            icon: 'iconWallet',
            color: '#3396FF',
            projectId: env.OAUTH_WALLETCONNECT_PROJECT_ID,
            // If proxy is enabled, provide the internal proxy paths
            relayUrl: env.OAUTH_WALLETCONNECT_SELF_PROXY === 'true' ? '/api/oauth/wc-proxy/relay' : undefined,
            verifyUrl: env.OAUTH_WALLETCONNECT_SELF_PROXY === 'true' ? '/api/oauth/wc-proxy/verify' : undefined
        });
    }

    return providers;
}