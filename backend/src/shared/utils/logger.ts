import process from 'node:process';

/**
 * 职责: 统一全栈日志过滤与格式化，支持日志级别过滤。
 */
export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3,
}

const LogLevelMap: Record<string, LogLevel> = {
    debug: LogLevel.DEBUG,
    info: LogLevel.INFO,
    warn: LogLevel.WARN,
    error: LogLevel.ERROR,
};

class Logger {
    private level: LogLevel = LogLevel.INFO;

    constructor() {
        this.initializeFromEnv();
    }

    /**
     * 自动从环境变量同步日志级别 (支持 Docker / Cloudflare 各种环境杂质清洗)
     */
    private initializeFromEnv(): void {
        const raw = process.env.LOG_LEVEL;
        if (raw) {
            const normalized = raw.trim().replace(/["']/g, '').toLowerCase();
            const target = LogLevelMap[normalized];
            if (target !== undefined) {
                this.level = target;
            }
        }
    }

    /**
     * 手动更新级别 (保留去干扰清洗逻辑)
     */
    public setLevel(level: string | LogLevel): void {
        const newLevel = typeof level === 'string'
            ? LogLevelMap[level.trim().replace(/["']/g, '').toLowerCase()]
            : level;

        if (newLevel !== undefined) {
            this.level = newLevel;
        }
    }

    private format(level: string, message: string): string {
        return `[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}`;
    }

    private log(targetLevel: LogLevel, levelName: string, message: string, ...args: any[]): void {
        if (this.level <= targetLevel) {
            const method = levelName === 'debug' ? 'log' : levelName as 'info' | 'warn' | 'error';
            console[method](this.format(levelName, message), ...args);
        }
    }

    public debug(m: string, ...a: any[]) { this.log(LogLevel.DEBUG, 'debug', m, ...a); }
    public info(m: string, ...a: any[]) { this.log(LogLevel.INFO, 'info', m, ...a); }
    public warn(m: string, ...a: any[]) { this.log(LogLevel.WARN, 'warn', m, ...a); }
    public error(m: string, ...a: any[]) { this.log(LogLevel.ERROR, 'error', m, ...a); }
}

export const logger = new Logger();
