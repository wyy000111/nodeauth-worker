import { describe, it, expect, vi } from 'vitest';
import { MySqlExecutor } from '../../src/shared/db/mySqlExecutor.js';
import { PgExecutor } from '../../src/shared/db/pgExecutor.js';

describe('MySqlExecutor (Happy Path)', () => {
    it('should use execute() on pools when preparing', async () => {
        const mockRow = { id: 1 };
        const mockPool = {
            execute: vi.fn().mockResolvedValue([[mockRow]])
        };
        const executor = new MySqlExecutor({});
        (executor as any).pool = mockPool;

        const result = await executor.prepare('SELECT 1').get();
        expect(mockPool.execute).toHaveBeenCalledWith('SELECT 1', []);
        expect(result).toEqual(mockRow);
    });
});

describe('PgExecutor (Dialect Adaptation)', () => {
    it('should correctly convert ? to $1, $2 for Postgres', async () => {
        const mockPool = {
            query: vi.fn().mockResolvedValue({ rows: [{ val: 1 }] })
        };
        const executor = new PgExecutor({});
        (executor as any).pool = mockPool;

        await executor.prepare('INSERT INTO test (a, b) VALUES (?, ?)').run(10, 20);

        // Correctly converted ? to $1, $2
        expect(mockPool.query).toHaveBeenCalledWith('INSERT INTO test (a, b) VALUES ($1, $2)', [10, 20]);
    });

    it('should handle many placeholders without conflicts', async () => {
        const mockPool = {
            query: vi.fn().mockResolvedValue({ rows: [] })
        };
        const executor = new PgExecutor({});
        (executor as any).pool = mockPool;

        const manyQm = 'SELECT ? + ? + ?';
        await executor.prepare(manyQm).get(1, 2, 3);

        expect(mockPool.query).toHaveBeenCalledWith('SELECT $1 + $2 + $3', [1, 2, 3]);
    });
});
