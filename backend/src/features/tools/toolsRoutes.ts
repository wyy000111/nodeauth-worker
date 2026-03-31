import { Hono } from 'hono';
import { EnvBindings } from '@/app/config';
import { authMiddleware } from '@/shared/middleware/auth';

const tools = new Hono<{ Bindings: EnvBindings, Variables: { user: any } }>();

tools.use('/*', authMiddleware);

// 获取服务器时间 (用于前端本地时间校准)
tools.get('/server-time', (c) => {
    return c.json({ success: true, time: Date.now() });
});

export default tools;
