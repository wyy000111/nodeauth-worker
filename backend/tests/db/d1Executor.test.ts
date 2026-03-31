import { describe, it, expect, vi } from 'vitest';
import { D1Executor } from '../../src/shared/db/d1Executor.js';

describe('D1Executor for Cloudflare Workers', () => {
    it('should correctly execute bare SQL via exec()', async () => {
        const mockD1 = { exec: vi.fn().mockResolvedValue(undefined) };
        const executor = new D1Executor(mockD1);

        await executor.exec('CREATE TABLE test (id int)');
        expect(mockD1.exec).toHaveBeenCalledWith('CREATE TABLE test (id int)');
    });

    it('should correctly bind parameters and return single row via get()', async () => {
        const mockStmt = {
            bind: vi.fn().mockReturnThis(),
            first: vi.fn().mockResolvedValue({ id: 1, name: 'Alice' })
        };
        const mockD1 = { prepare: vi.fn().mockReturnValue(mockStmt) };
        const executor = new D1Executor(mockD1);

        const row = await executor.prepare('SELECT * FROM test WHERE id = ?').get(1);

        expect(mockD1.prepare).toHaveBeenCalledWith('SELECT * FROM test WHERE id = ?');
        expect(mockStmt.bind).toHaveBeenCalledWith(1);
        expect(row).toEqual({ id: 1, name: 'Alice' });
    });

    it('should correctly bind parameters and execute via run()', async () => {
        const mockStmt = {
            bind: vi.fn().mockReturnThis(),
            run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } })
        };
        const mockD1 = { prepare: vi.fn().mockReturnValue(mockStmt) };
        const executor = new D1Executor(mockD1);

        const res = await executor.prepare('INSERT INTO test (id) VALUES (?)').run(42);

        expect(mockD1.prepare).toHaveBeenCalledWith('INSERT INTO test (id) VALUES (?)');
        expect(mockStmt.bind).toHaveBeenCalledWith(42);
        expect(res).toEqual({ success: true, meta: { changes: 1 } });
    });

    it('should correctly map strings to batch() execution', async () => {
        const mockStmtA = { id: 'A' };
        const mockStmtB = { id: 'B' };

        const mockD1 = {
            prepare: vi.fn().mockImplementation((sql) => {
                if (sql === 'QUERY A') return mockStmtA;
                return mockStmtB;
            }),
            batch: vi.fn().mockResolvedValue([{ success: true }])
        };
        const executor = new D1Executor(mockD1);

        await executor.batch(['QUERY A', 'QUERY B']);
        expect(mockD1.prepare).toHaveBeenCalledTimes(2);
        expect(mockD1.batch).toHaveBeenCalledWith([mockStmtA, mockStmtB]);
    });
});
