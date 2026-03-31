import { SECURITY_CONFIG } from '@/app/config';

export function sanitizeInput(input: any, maxLength = SECURITY_CONFIG.MAX_INPUT_LENGTH): string {
    if (typeof input !== 'string') return '';
    // 增强正则表达式：不仅过滤 HTML 字符，还过滤控制字符、不可见字符和代理对
    return input
        .replace(/[<>"'&\x00-\x1F\x7F-\x9F\u200B-\u200D\uFEFF]/g, '') // 控制字符 & 不可见字符
        .trim()
        .substring(0, maxLength);
}

export function validateServiceName(service: any): boolean {
    const cleaned = sanitizeInput(service, 50);
    return cleaned.length >= 1 && cleaned.length <= 50;
}

export function validateAccountName(account: any): boolean {
    const cleaned = sanitizeInput(account, 100);
    return cleaned.length >= 1 && cleaned.length <= 100;
}
