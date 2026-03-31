import { BackupProvider, BackupFile } from '@/features/backup/providers/backupProvider';
import { backupEmailHistory } from '@/shared/db/schema';
import { eq, desc, and } from 'drizzle-orm';

// ============================================================
// 纯手写 SMTP 客户端 (兼容 Cloudflare Workers TCP + Node.js网络)
// 遵循 RFC 5321/5322，支持 STARTTLS (587) 和 SSL/TLS (465)
// ============================================================

/**
 * 将任意字符串编码为 UTF-8 安全的 Base64（兼容 Workers 和 Node.js）
 * 使用 TextEncoder 确保正确处理中文、emoji 等多字节字符，
 * 避免直接使用 btoa() 因 Latin1 限制而报错。
 */
function encodeBase64Utf8(str: string): string {
    const bytes = new TextEncoder().encode(str);
    let binary = '';
    bytes.forEach(b => binary += String.fromCharCode(b));
    return btoa(binary);
}

/**
 * 构建符合 RFC 5322 规范的 MIME 邮件原文（带 base64 附件）
 */
function buildMimeEmail(params: {
    from: string;
    to: string;
    subject: string;
    body: string;
    filename: string;
    attachmentData: string; // base64 encoded
}): string {
    const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const encodedSubject = `=?UTF-8?B?${encodeBase64Utf8(params.subject)}?=`;

    // Split base64 into 76-char lines (RFC 2045)
    const b64Lines = params.attachmentData.match(/.{1,76}/g)?.join('\r\n') || params.attachmentData;

    return [
        `From: ${params.from}`,
        `To: ${params.to}`,
        `Subject: ${encodedSubject}`,
        `MIME-Version: 1.0`,
        `Content-Type: multipart/mixed; boundary="${boundary}"`,
        ``,
        `--${boundary}`,
        `Content-Type: text/plain; charset=UTF-8`,
        `Content-Transfer-Encoding: base64`,
        ``,
        encodeBase64Utf8(params.body),
        ``,
        `--${boundary}`,
        `Content-Type: application/json; name="${params.filename}"`,
        `Content-Transfer-Encoding: base64`,
        `Content-Disposition: attachment; filename="${params.filename}"`,
        ``,
        b64Lines,
        ``,
        `--${boundary}--`,
    ].join('\r\n');
}

// ============================================================
// 发信核心：通过 fetch + SMTP Relay (Mailchannels-compatible)
// 或直接使用 SMTP over TCP (via Cloudflare connect() or Node net)
// 
// 架构决策：使用 nodemailer API-compatible 抽象层
// - Docker (Node.js) => 动态 require('nodemailer')
// - Workers => HTTP-based relay / TCP connect()
// ============================================================

type SmtpConfig = {
    host: string;
    port: number;
    secure: boolean; // true = SSL/TLS (465), false = STARTTLS (587)
    user: string;
    password: string;
    from: string;
    to: string;
};

const EMAIL_TRANSLATIONS: Record<string, any> = {
    'zh-CN': {
        subject: '📦 NodeAuth 定期备份 {time}',
        intro: '您好，\n\n这是您的 NodeAuth 自动定期备份文件，请妥善保管。',
        filename: '文件名：{filename}',
        time: '备份时间：{time}',
        note: '注意：附件内容经过 AES-256 加密，请使用您设置的备份密码进行解密恢复。',
        footer: '---\nNodeAuth 自动备份系统',
        testSubject: '🔗 NodeAuth 备份源连接测试',
        testBody: '✅ 您的 NodeAuth 邮件备份源已成功连接！'
    },
    'en-US': {
        subject: '📦 NodeAuth Scheduled Backup {time}',
        intro: 'Hello,\n\nThis is your NodeAuth automatic scheduled backup file. Please keep it safe.',
        filename: 'Filename: {filename}',
        time: 'Backup Time: {time}',
        note: 'Note: The attachment is encrypted with AES-256. Please use your backup password to decrypt and restore it.',
        footer: '---\nNodeAuth Automatic Backup System',
        testSubject: '🔗 NodeAuth Backup Connection Test',
        testBody: '✅ Your NodeAuth email backup connection is working correctly!'
    }
};

/**
 * 通用发邮件函数。
 * 在 Node.js (Docker) 环境下，动态加载 nodemailer。
 * 在 Cloudflare Workers 环境下，使用 MailChannels HTTP relay 或原生 TCP。
 */
async function sendEmail(smtp: SmtpConfig, subject: string, body: string, filename: string, attachmentData: string): Promise<void> {
    // 检测运行环境：
    // - 真实 Node.js (Docker): process.versions.node 存在，且 new Function() 不受 CSP 限制
    // - Cloudflare Workers 运行时 / wrangler dev (miniflare): V8 isolate 会阻止 new Function()
    //   即使 process 对象存在（miniflare 在 Node.js 中运行），CSP 仍然生效
    // 用 "能否执行 new Function" 来区分两者，比单纯检查 process.versions.node 更可靠
    let isRealNode = false;
    try {
        new Function('return true')();
        isRealNode = typeof process !== 'undefined' && !!process.versions?.node;
    } catch (_) {
        isRealNode = false; // 被 CSP 阻止 → 在 Workers/miniflare 沙箱中
    }

    if (isRealNode) {
        // ---- Docker / Node.js 路径：使用 nodemailer ----
        // 使用 new Function() 包裹 import，防止 esbuild (wrangler) 在编译期静态解析 nodemailer。
        // 该代码块只在 Node.js 运行时执行（isNode 为 true），Workers 环境永远不会触达此处。
        // eslint-disable-next-line no-new-func
        const nodemailer = await new Function('m', 'return import(m)')('nodemailer');
        const transporter = nodemailer.createTransport({
            host: smtp.host,
            port: smtp.port,
            secure: smtp.secure,
            auth: {
                user: smtp.user,
                pass: smtp.password,
            },
        });

        await transporter.sendMail({
            from: smtp.from || smtp.user,
            to: smtp.to,
            subject: subject,
            text: body,
            attachments: [
                {
                    filename: filename,
                    content: attachmentData,
                    encoding: 'base64',
                    contentType: 'application/json',
                },
            ],
        });
    } else {
        // ---- Cloudflare Workers 路径：使用 cloudflare:sockets 直连 SMTP ----
        // 部分邮件服务（如 QQ Mail）的 SMTP 服务器群有负载均衡，不同实例对
        // Cloudflare 出口 IP 的策略不同。最多重试 3 次（每次新 TCP 连接可能
        // 命中不同的服务器实例），遇到明确的认证失败则立即停止（不再重试）。
        const MAX_ATTEMPTS = 3;
        let lastError: Error = new Error('email_send_failed: unknown');

        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            try {
                await sendViaSmtpTcp(smtp, subject, body, filename, attachmentData);
                return; // 发送成功，退出
            } catch (e: any) {
                lastError = e;
                // 认证错误（5xx auth 类）是终止性错误，无需重试
                const isAuthError = e.message?.includes('auth_success_failed') ||
                    e.message?.includes('535') || e.message?.includes('534') ||
                    e.message?.includes('Username and Password not accepted');
                if (isAuthError || attempt === MAX_ATTEMPTS) break;
                // 短暂等待后重试（利用 DNS 轮询命中不同服务器实例）
                await new Promise(resolve => setTimeout(resolve, 600));
            }
        }

        throw lastError;
    }
}

/**
 * Cloudflare Workers 路径：使用 cloudflare:sockets 原生 TCP 直连 SMTP 服务器
 *
 * 支持：
 *   - SSL/TLS (port 465)：连接时即刻加密（secureTransport: 'on'）
 *   - STARTTLS (port 587)：先明文连接，发 STARTTLS 后升级到 TLS（secureTransport: 'starttls'）
 *
 * 协议：RFC 5321，使用 AUTH LOGIN 认证机制
 */
async function sendViaSmtpTcp(smtp: SmtpConfig, subject: string, body: string, filename: string, attachmentData: string): Promise<void> {
    // cloudflare:sockets 是 Cloudflare Workers 内置外部模块，
    // wrangler/esbuild 会自动标记为 external，不用 new Function 技巧。
    // Node.js (Docker) 路径由 isNode 幸下防护，永远不会进入此函数。
    // @ts-ignore - cloudflare:sockets 是 Workers 运行时内置模块
    const { connect } = await import('cloudflare:sockets');

    const rawEmail = buildMimeEmail({
        from: smtp.from || smtp.user,
        to: smtp.to,
        subject,
        body,
        filename,
        attachmentData,
    });

    const isSSL = smtp.secure; // true = port 465 (SSL), false = port 587 (STARTTLS)

    // 建立 TCP 连接
    let sock = connect(`${smtp.host}:${smtp.port}`, {
        secureTransport: isSSL ? 'on' : 'starttls',
        allowHalfOpen: false,
    });

    const dec = new TextDecoder();
    const enc = new TextEncoder();
    let buf = '';
    let reader = sock.readable.getReader();
    let writer = sock.writable.getWriter();

    /**
     * 读取一条完整 SMTP 响应（自动处理多行，如 EHLO 能力列表）
     * SMTP 多行格式：250-XXX（连续行）/ 250 XXX（最后一行，第4字符为空格）
     */
    const readResp = async (): Promise<string> => {
        let last = '';
        for (; ;) {
            const nl = buf.indexOf('\n');
            if (nl !== -1) {
                const line = buf.slice(0, nl).replace(/\r$/, '');
                buf = buf.slice(nl + 1);
                last = line;
                // 第4个字符是 '-' 说明还有后续行；空格或不足4字符说明是最后一行
                if (line.length < 4 || line[3] !== '-') return line;
            } else {
                try {
                    const { value, done } = await reader.read();
                    if (done) {
                        // 服务器关闭连接，返回已读到的最后一行（如果有）
                        if (last) return last;
                        throw new Error('smtp_connection_closed: Server closed the connection unexpectedly');
                    }
                    buf += dec.decode(value);
                } catch (e: any) {
                    // 流被取消（如服务器拒绝 IP、TLS 握手失败、连接重置等）
                    if (e.message?.includes('smtp_')) throw e; // 重新抛出已格式化的错误
                    throw new Error(
                        `smtp_connection_closed: ${e.message}. ` +
                        `Possible causes: server rejected your IP (common with Chinese providers from Cloudflare), ` +
                        `wrong credentials, or TLS handshake failure.`
                    );
                }
            }
        }
    };

    const send = (s: string) => writer.write(enc.encode(s + '\r\n'));

    /**
     * 发送命令并验证响应码，不匹配则抛出含服务器应答的错误
     */
    const expect = async (code: string, label: string): Promise<string> => {
        const resp = await readResp();
        if (!resp.startsWith(code)) throw new Error(`smtp_${label}_failed: ${resp.slice(0, 120)}`);
        return resp;
    };

    try {
        // 1. 服务器问候
        await expect('220', 'greeting');

        // 2. EHLO — 声明客户端身份并获取服务器能力
        await send('EHLO nodeauth');
        await expect('250', 'ehlo');

        // 3. STARTTLS 升级（仅 587 端口需要）
        if (!isSSL) {
            await send('STARTTLS');
            await expect('220', 'starttls_ready');

            // ⚠️ 关键：必须用同步的 releaseLock() 释放锁，再调用 startTls()
            // reader.cancel() 是异步的，锁未立即释放，会导致 startTls() 后
            // tlsSock.readable.getReader() 抛出 "ReadableStream has been locked" 错误
            reader.releaseLock();
            writer.releaseLock();

            const tlsSock = sock.startTls();
            buf = '';
            reader = tlsSock.readable.getReader();
            writer = tlsSock.writable.getWriter();

            // TLS 握手完成后需再次发送 EHLO
            await send('EHLO nodeauth');
            await expect('250', 'ehlo_after_tls');
        }

        // 4. AUTH LOGIN 认证
        await send('AUTH LOGIN');
        await expect('334', 'auth_prompt_user');
        // 用户名和密码分别 Base64 编码（使用 UTF-8 安全编码确保兼容性）
        await send(encodeBase64Utf8(smtp.user));
        await expect('334', 'auth_prompt_pass');
        await send(encodeBase64Utf8(smtp.password));
        await expect('235', 'auth_success');

        // 5. 发件人和收件人信封
        await send(`MAIL FROM:<${smtp.from || smtp.user}>`);
        await expect('250', 'mail_from');

        await send(`RCPT TO:<${smtp.to}>`);
        await expect('250', 'rcpt_to');

        // 6. 邮件正文传输
        await send('DATA');
        await expect('354', 'data_ready');

        // RFC 2821 dot-stuffing：以 '.' 开头的行需要再加一个 '.'，防止误触 DATA 结束标记
        const stuffed = rawEmail
            .split('\r\n')
            .map(line => line.startsWith('.') ? '.' + line : line)
            .join('\r\n');
        // 邮件内容后跟 <CRLF>.<CRLF> 表示 DATA 结束
        await writer.write(enc.encode(stuffed + '\r\n.\r\n'));
        await expect('250', 'message_accepted');

        // 7. 正常退出
        await send('QUIT');
        // QUIT 响应为 221，不必强制检查（部分服务器直接关闭连接）
        await readResp().catch(() => { });

    } finally {
        writer.close().catch(() => { });
    }
}

// ============================================================
// EmailProvider 类实现
// ============================================================

export class EmailProvider implements BackupProvider {
    private smtp: SmtpConfig;
    private db: any;
    private providerId: number | undefined;
    private lang: string;

    constructor(config: any, db?: any, providerId?: number, lang: string = 'en-US') {
        if (!config.smtpHost || !config.smtpUser || !config.smtpPassword || !config.smtpTo) {
            throw new Error('email_config_incomplete');
        }

        this.smtp = {
            host: config.smtpHost,
            port: parseInt(config.smtpPort || '587', 10),
            secure: config.smtpSecure === true || config.smtpSecure === 'true',
            user: config.smtpUser,
            password: config.smtpPassword,
            from: config.smtpFrom || config.smtpUser,
            to: config.smtpTo,
        };

        this.db = db;
        this.providerId = providerId;
        this.lang = lang;
    }

    async testConnection(): Promise<boolean> {
        // 发送一封测试邮件来验证配置
        const t = EMAIL_TRANSLATIONS[this.lang] || EMAIL_TRANSLATIONS['en-US'];
        const subject = t.testSubject;
        const body = t.testBody;
        const filename = 'nodeauth-test-email.txt';

        try {
            await sendEmail(this.smtp, subject, body, filename, encodeBase64Utf8(body));
            return true;
        } catch (e: any) {
            throw new Error(`email_send_failed: ${e.message}`);
        }
    }

    async listBackups(): Promise<BackupFile[]> {
        if (!this.db || !this.providerId) {
            throw new Error('email_db_missing');
        }

        const histories = await this.db.select()
            .from(backupEmailHistory)
            .where(eq(backupEmailHistory.providerId, this.providerId))
            .orderBy(desc(backupEmailHistory.createdAt));

        return histories.map((h: any) => ({
            filename: h.filename,
            size: h.size,
            lastModified: new Date(h.createdAt).toISOString(),
        }));
    }

    async uploadBackup(filename: string, data: string): Promise<void> {
        if (!this.db || !this.providerId) {
            throw new Error('email_db_missing');
        }

        const ts = new Date().toISOString();
        const t = EMAIL_TRANSLATIONS[this.lang] || EMAIL_TRANSLATIONS['en-US'];

        const subject = t.subject.replace('{time}', ts);
        const body = [
            t.intro,
            '',
            t.filename.replace('{filename}', filename),
            t.time.replace('{time}', ts),
            '',
            t.note,
            '',
            t.footer
        ].join('\n');

        const attachmentData = encodeBase64Utf8(data);

        await sendEmail(this.smtp, subject, body, filename, attachmentData);

        // 记录到本地历史
        await this.db.insert(backupEmailHistory).values({
            providerId: this.providerId,
            filename: filename,
            recipient: this.smtp.to,
            size: data.length,
            createdAt: Date.now(),
        });
    }

    async downloadBackup(filename: string): Promise<string> {
        // Email 是"推"模式，不支持从邮箱下载。
        // 抛出明确的错误告知用户需要从邮箱手动下载附件并上传恢复。
        throw new Error('email_download_not_supported');
    }

    async deleteBackup(filename: string): Promise<void> {
        if (!this.db || !this.providerId) {
            throw new Error('email_db_missing');
        }

        // 仅删除本地历史记录（无法撤回已发送的邮件）
        const _recordResult = await this.db.select()
            .from(backupEmailHistory)
            .where(and(
                eq(backupEmailHistory.providerId, this.providerId),
                eq(backupEmailHistory.filename, filename)
            ))
            .limit(1);
        const record = _recordResult[0];

        if (record) {
            await this.db.delete(backupEmailHistory)
                .where(eq(backupEmailHistory.id, record.id));
        }
    }
}
