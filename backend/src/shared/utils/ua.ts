/**
 * 极简 Web-safe UA 解析器 (适用于 Cloudflare Workers)
 */
export function parseUserAgent(ua: string): string {
    if (!ua || ua === 'Unknown Device') return 'Unknown Device';

    const dt = ua.toLowerCase();

    // 1. 识别操作系统 (OS)
    let os = 'Unknown OS';
    let osVersion = '';

    if (dt.includes('iphone')) {
        os = 'iPhone';
        const match = ua.match(/OS (\d+[_.\d]+)/i);
        if (match) osVersion = match[1].replace(/_/g, '.');
    } else if (dt.includes('ipad')) {
        os = 'iPad';
        const match = ua.match(/OS (\d+[_.\d]+)/i);
        if (match) osVersion = match[1].replace(/_/g, '.');
    } else if (dt.includes('android')) {
        os = 'Android';
        const match = ua.match(/Android (\d+)/i);
        if (match) osVersion = match[1];
    } else if (dt.includes('windows nt')) {
        os = 'Windows';
        if (dt.includes('nt 10.0')) osVersion = '10/11';
        else if (dt.includes('nt 6.3')) osVersion = '8.1';
        else if (dt.includes('nt 6.2')) osVersion = '8';
        else if (dt.includes('nt 6.1')) osVersion = '7';
    } else if (dt.includes('macintosh')) {
        os = 'macOS';
        const match = ua.match(/Mac OS X (\d+[_.\d]+)/i);
        if (match) osVersion = match[1].replace(/_/g, '.');
    } else if (dt.includes('linux')) {
        os = 'Linux';
    }

    // 2. 识别浏览器 (Browser)
    let browser = 'Browser';
    if (dt.includes('micromessenger')) browser = 'WeChat';
    else if (dt.includes('edg/') || dt.includes('edgios/')) browser = 'Edge';
    else if (dt.includes('chromium/')) browser = 'Chromium';
    else if ((dt.includes('chrome/') || dt.includes('crios/')) && !dt.includes('chromium')) browser = 'Chrome';
    else if (dt.includes('firefox/') || dt.includes('fxios/')) browser = 'Firefox';
    else if (dt.includes('opios/')) browser = 'Opera';
    else if (dt.includes('safari/') && !dt.includes('chrome/') && !dt.includes('crios/') && !dt.includes('fxios/') && !dt.includes('edgios/') && !dt.includes('opios/') && !dt.includes('chromium/')) browser = 'Safari';

    // 3. 拼接友好名称
    const osFull = osVersion ? `${os} ${osVersion}` : os;
    return `${browser} on ${osFull}`;
}
