
/**
 * 日志级别定义
 */
export const LogLevel = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
};

const LogLevelMap = {
    debug: LogLevel.DEBUG,
    info: LogLevel.INFO,
    warn: LogLevel.WARN,
    error: LogLevel.ERROR,
};

/**
 * 核心日志工具类 (Frontend)
 * 职责: 统一日志输出格式，支持级别过滤
 */
class Logger {
    constructor() {
        this.level = LogLevel.INFO;

        // 尝试从 Vite 环境变量或 localStorage 获取日志级别
        const envLevel = import.meta.env?.VITE_LOG_LEVEL || localStorage.getItem('LOG_LEVEL');
        if (envLevel) {
            this.setLevel(envLevel);
        }
    }

    /**
     * 设置日志级别
     */
    setLevel(level) {
        if (typeof level === 'string') {
            const normalizedLevel = level.toLowerCase();
            if (LogLevelMap[normalizedLevel] !== undefined) {
                this.level = LogLevelMap[normalizedLevel];
            }
        } else if (typeof level === 'number') {
            this.level = level;
        }
    }

    formatMessage(level, message) {
        const timestamp = new Date().toLocaleTimeString();
        return `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    }

    debug(message, ...args) {
        if (this.level <= LogLevel.DEBUG) {
            console.log(this.formatMessage('debug', message), ...args);
        }
    }

    info(message, ...args) {
        if (this.level <= LogLevel.INFO) {
            console.info(this.formatMessage('info', message), ...args);
        }
    }

    warn(message, ...args) {
        if (this.level <= LogLevel.WARN) {
            console.warn(this.formatMessage('warn', message), ...args);
        }
    }

    error(message, ...args) {
        if (this.level <= LogLevel.ERROR) {
            console.error(this.formatMessage('error', message), ...args);
        }
    }
}

export const logger = new Logger();
