/**
 * Masking utilities for user data privacy
 */

/**
 * Desensitize user ID or email
 * Scheme: Keep first 3 chars if length >= 3, else keep 1 char. Append '***'.
 * For emails, process username part separately.
 */
export const maskUserId = (id: string | null | undefined): string => {
    if (!id) return '***';

    // 处理邮箱格式
    if (id.includes('@')) {
        const [username, domain] = id.split('@');
        if (username.length >= 3) {
            return `${username.slice(0, 3)}***@${domain}`;
        }
        return `${username.slice(0, 1) || ''}***@${domain}`;
    }

    // 处理纯数字、UUID或普通字符串
    if (id.length >= 3) {
        return `${id.slice(0, 3)}***`;
    }
    return `${id.slice(0, 1) || ''}***`;
};

/**
 * Desensitize IP addresses (IPv4 / IPv6)
 */
export const maskIp = (ip: string | null | undefined): string => {
    if (!ip) return '***';

    // IPv4: 1.2.3.4 -> 1.2.3.***
    if (ip.includes('.')) {
        const parts = ip.split('.');
        if (parts.length >= 4) {
            return `${parts[0]}.${parts[1]}.${parts[2]}.***`;
        }
    }

    // IPv6: a:b:c:d:e:f -> a:b:c:d:****
    if (ip.includes(':')) {
        const parts = ip.split(':');
        if (parts.length >= 4) {
            return `${parts[0]}:${parts[1]}:${parts[2]}:${parts[3]}:****`;
        }
    }

    return ip;
};
