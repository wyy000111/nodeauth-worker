import { EnvBindings } from '@/app/config';

export type HealthIssueLevel = 'critical' | 'error' | 'warning';

export interface HealthIssue {
    field: string;
    level: HealthIssueLevel;
    message: string;
    suggestion: string;
    deploy_by_worker: string;
    deploy_by_gitaction: string;
    deploy_by_docker: string;
    missingFields?: string[];
}

export interface HealthCheckResult {
    passed: boolean;
    issues: HealthIssue[];
    passedChecks: string[];
}

export const runHealthCheck = (env: EnvBindings): HealthCheckResult => {
    const issues: HealthIssue[] = [];
    const passedChecks: string[] = [];

    // 1. Check ENCRYPTION_KEY
    const encKey = env.ENCRYPTION_KEY || '';
    // Note: User requests >= 32 length
    if (!encKey || encKey.length < 32) {
        issues.push({
            field: 'ENCRYPTION_KEY',
            level: 'critical',
            message: 'encryption_key_too_short',
            suggestion: 'encryption_key_suggestion',
            deploy_by_worker: 'suggestion_deploy_by_worker',
            deploy_by_gitaction: 'suggestion_deploy_by_gitaction',
            deploy_by_docker: 'suggestion_deploy_by_docker'
        });
    } else {
        passedChecks.push('encryption_key_passed');
    }

    // 2. Check JWT_SECRET
    const jwtSecret = env.JWT_SECRET || '';
    if (!jwtSecret || jwtSecret.length < 32) {
        issues.push({
            field: 'JWT_SECRET',
            level: 'critical',
            message: 'jwt_secret_too_short',
            suggestion: 'jwt_secret_suggestion',
            deploy_by_worker: 'suggestion_deploy_by_worker',
            deploy_by_gitaction: 'suggestion_deploy_by_gitaction',
            deploy_by_docker: 'suggestion_deploy_by_docker'
        });
    } else {
        passedChecks.push('jwt_secret_passed');
    }

    // 3. Check OAUTH_ALLOW_ALL
    if (String(env.OAUTH_ALLOW_ALL).toLowerCase() === 'true' || env.OAUTH_ALLOW_ALL === '1') {
        issues.push({
            field: 'OAUTH_ALLOW_ALL',
            level: 'critical',
            message: 'oauth_allow_all_enabled',
            suggestion: 'oauth_allow_all_suggestion',
            deploy_by_worker: 'suggestion_deploy_by_worker',
            deploy_by_gitaction: 'suggestion_deploy_by_gitaction',
            deploy_by_docker: 'suggestion_deploy_by_docker'
        });
    } else {
        passedChecks.push('oauth_allow_all_passed');
    }

    // 4. Check OAUTH_ALLOWED_USERS
    const allowedUsers = env.OAUTH_ALLOWED_USERS || '';
    if (!allowedUsers || allowedUsers.trim().length === 0) {
        issues.push({
            field: 'OAUTH_ALLOWED_USERS',
            level: 'error',
            message: 'allowed_users_empty',
            suggestion: 'allowed_users_suggestion',
            deploy_by_worker: 'suggestion_deploy_by_worker',
            deploy_by_gitaction: 'suggestion_deploy_by_gitaction',
            deploy_by_docker: 'suggestion_deploy_by_docker'
        });
    } else {
        passedChecks.push('allowed_users_passed');
    }

    // 5. Check OAuth Providers Integrity
    let hasAtLeastOneProvider = false;
    const providerStatus: Record<string, 'passed' | 'missing' | 'none'> = {
        github: 'none', telegram: 'none', google: 'none', nodeloc: 'none', gitee: 'none', cloudflare: 'none'
    };

    // Github
    if (env.OAUTH_GITHUB_CLIENT_ID || env.OAUTH_GITHUB_CLIENT_SECRET || env.OAUTH_GITHUB_REDIRECT_URI) {
        const missing = [];
        if (!env.OAUTH_GITHUB_CLIENT_ID) missing.push('OAUTH_GITHUB_CLIENT_ID');
        if (!env.OAUTH_GITHUB_CLIENT_SECRET) missing.push('OAUTH_GITHUB_CLIENT_SECRET');
        if (!env.OAUTH_GITHUB_REDIRECT_URI) missing.push('OAUTH_GITHUB_REDIRECT_URI');

        if (missing.length > 0) {
            providerStatus.github = 'missing';
            issues.push({
                field: 'OAUTH_GITHUB',
                level: 'error',
                message: 'github_config_incomplete',
                suggestion: 'github_config_suggestion',
                deploy_by_worker: 'suggestion_deploy_by_worker',
                deploy_by_gitaction: 'suggestion_deploy_by_gitaction',
                deploy_by_docker: 'suggestion_deploy_by_docker',
                missingFields: missing
            });
        } else {
            hasAtLeastOneProvider = true;
            providerStatus.github = 'passed';
        }
    }

    // Telegram
    if (env.OAUTH_TELEGRAM_BOT_NAME || env.OAUTH_TELEGRAM_BOT_TOKEN) {
        const missing = [];
        if (!env.OAUTH_TELEGRAM_BOT_NAME) missing.push('OAUTH_TELEGRAM_BOT_NAME');
        if (!env.OAUTH_TELEGRAM_BOT_TOKEN) missing.push('OAUTH_TELEGRAM_BOT_TOKEN');

        if (missing.length > 0) {
            providerStatus.telegram = 'missing';
            issues.push({
                field: 'OAUTH_TELEGRAM',
                level: 'error',
                message: 'telegram_config_incomplete',
                suggestion: 'telegram_config_suggestion',
                deploy_by_worker: 'suggestion_deploy_by_worker',
                deploy_by_gitaction: 'suggestion_deploy_by_gitaction',
                deploy_by_docker: 'suggestion_deploy_by_docker',
                missingFields: missing
            });
        } else {
            hasAtLeastOneProvider = true;
            providerStatus.telegram = 'passed';
        }
    }

    // Google
    if (env.OAUTH_GOOGLE_CLIENT_ID || env.OAUTH_GOOGLE_CLIENT_SECRET || env.OAUTH_GOOGLE_REDIRECT_URI) {
        const missing = [];
        if (!env.OAUTH_GOOGLE_CLIENT_ID) missing.push('OAUTH_GOOGLE_CLIENT_ID');
        if (!env.OAUTH_GOOGLE_CLIENT_SECRET) missing.push('OAUTH_GOOGLE_CLIENT_SECRET');
        if (!env.OAUTH_GOOGLE_REDIRECT_URI) missing.push('OAUTH_GOOGLE_REDIRECT_URI');

        if (missing.length > 0) {
            providerStatus.google = 'missing';
            issues.push({
                field: 'OAUTH_GOOGLE',
                level: 'error',
                message: 'google_config_incomplete',
                suggestion: 'google_config_suggestion',
                deploy_by_worker: 'suggestion_deploy_by_worker',
                deploy_by_gitaction: 'suggestion_deploy_by_gitaction',
                deploy_by_docker: 'suggestion_deploy_by_docker',
                missingFields: missing
            });
        } else {
            hasAtLeastOneProvider = true;
            providerStatus.google = 'passed';
        }
    }

    // NodeLoc
    if (env.OAUTH_NODELOC_CLIENT_ID || env.OAUTH_NODELOC_CLIENT_SECRET || env.OAUTH_NODELOC_REDIRECT_URI) {
        const missing = [];
        if (!env.OAUTH_NODELOC_CLIENT_ID) missing.push('OAUTH_NODELOC_CLIENT_ID');
        if (!env.OAUTH_NODELOC_CLIENT_SECRET) missing.push('OAUTH_NODELOC_CLIENT_SECRET');
        if (!env.OAUTH_NODELOC_REDIRECT_URI) missing.push('OAUTH_NODELOC_REDIRECT_URI');

        if (missing.length > 0) {
            providerStatus.nodeloc = 'missing';
            issues.push({
                field: 'OAUTH_NODELOC',
                level: 'error',
                message: 'nodeloc_config_incomplete',
                suggestion: 'nodeloc_config_suggestion',
                deploy_by_worker: 'suggestion_deploy_by_worker',
                deploy_by_gitaction: 'suggestion_deploy_by_gitaction',
                deploy_by_docker: 'suggestion_deploy_by_docker',
                missingFields: missing
            });
        } else {
            hasAtLeastOneProvider = true;
            providerStatus.nodeloc = 'passed';
        }
    }

    // Gitee
    if (env.OAUTH_GITEE_CLIENT_ID || env.OAUTH_GITEE_CLIENT_SECRET || env.OAUTH_GITEE_REDIRECT_URI) {
        const missing = [];
        if (!env.OAUTH_GITEE_CLIENT_ID) missing.push('OAUTH_GITEE_CLIENT_ID');
        if (!env.OAUTH_GITEE_CLIENT_SECRET) missing.push('OAUTH_GITEE_CLIENT_SECRET');
        if (!env.OAUTH_GITEE_REDIRECT_URI) missing.push('OAUTH_GITEE_REDIRECT_URI');

        if (missing.length > 0) {
            providerStatus.gitee = 'missing';
            issues.push({
                field: 'OAUTH_GITEE',
                level: 'error',
                message: 'gitee_config_incomplete',
                suggestion: 'gitee_config_suggestion',
                deploy_by_worker: 'suggestion_deploy_by_worker',
                deploy_by_gitaction: 'suggestion_deploy_by_gitaction',
                deploy_by_docker: 'suggestion_deploy_by_docker',
                missingFields: missing
            });
        } else {
            hasAtLeastOneProvider = true;
            providerStatus.gitee = 'passed';
        }
    }

    // Cloudflare Access
    if (env.OAUTH_CLOUDFLARE_CLIENT_ID || env.OAUTH_CLOUDFLARE_CLIENT_SECRET || env.OAUTH_CLOUDFLARE_ORG_DOMAIN || env.OAUTH_CLOUDFLARE_REDIRECT_URI) {
        const missing = [];
        if (!env.OAUTH_CLOUDFLARE_CLIENT_ID) missing.push('OAUTH_CLOUDFLARE_CLIENT_ID');
        if (!env.OAUTH_CLOUDFLARE_CLIENT_SECRET) missing.push('OAUTH_CLOUDFLARE_CLIENT_SECRET');
        if (!env.OAUTH_CLOUDFLARE_ORG_DOMAIN) missing.push('OAUTH_CLOUDFLARE_ORG_DOMAIN');
        if (!env.OAUTH_CLOUDFLARE_REDIRECT_URI) missing.push('OAUTH_CLOUDFLARE_REDIRECT_URI');

        if (missing.length > 0) {
            providerStatus.cloudflare = 'missing';
            issues.push({
                field: 'OAUTH_CLOUDFLARE',
                level: 'error',
                message: 'cloudflare_config_incomplete',
                suggestion: 'cloudflare_config_suggestion',
                deploy_by_worker: 'suggestion_deploy_by_worker',
                deploy_by_gitaction: 'suggestion_deploy_by_gitaction',
                deploy_by_docker: 'suggestion_deploy_by_docker',
                missingFields: missing
            });
        } else {
            hasAtLeastOneProvider = true;
            providerStatus.cloudflare = 'passed';
        }
    }

    // 6. Check if any provider exists
    if (!hasAtLeastOneProvider) {
        issues.push({
            field: 'NO_OAUTH_PROVIDER',
            level: 'error',
            message: 'no_provider_configured',
            suggestion: 'no_provider_suggestion',
            deploy_by_worker: 'suggestion_deploy_by_worker',
            deploy_by_gitaction: 'suggestion_deploy_by_gitaction',
            deploy_by_docker: 'suggestion_deploy_by_docker'
        });
    } else {
        passedChecks.push('oauth_provider_configured');
    }

    return {
        passed: issues.length === 0,
        issues,
        passedChecks
    };
};
