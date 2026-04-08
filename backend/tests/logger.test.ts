import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logger, LogLevel } from '@/shared/utils/logger';
import process from 'node:process';

describe('Architected Logger Utility', () => {
    const originalLogLevel = process.env.LOG_LEVEL;

    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        process.env.LOG_LEVEL = originalLogLevel;
    });

    it('应当防御“降级覆盖”：已设为 WARN 后，禁止被改回 INFO', () => {
        process.env.LOG_LEVEL = 'warn';
        // @ts-ignore: 调用重组后的初始化方法
        logger.initializeFromEnv();

        // 尝试降级输出级别
        logger.setLevel('info');

        const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => { });
        logger.info('该条 INFO 日志不应输出');

        expect(infoSpy).not.toHaveBeenCalled();
    });

    it('应当能兼容带引号和空格的复杂输入', () => {
        process.env.LOG_LEVEL = ' "warn" ';
        // @ts-ignore
        logger.initializeFromEnv();

        const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => { });
        logger.info('拦截成功');
        expect(infoSpy).not.toHaveBeenCalled();
    });

    it('应当支持合法的级别升级操作', () => {
        process.env.LOG_LEVEL = 'info';
        // @ts-ignore
        logger.initializeFromEnv();

        // 合法升级到 warn
        logger.setLevel('warn');

        const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => { });
        logger.info('升级后应被拦截');
        expect(infoSpy).not.toHaveBeenCalled();
    });
});
