import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';

// setup 文件在每测试文件的存储隔离之外运行、可能多次执行；
// applyD1Migrations 只应用未应用的迁移，因此这里重复调用是安全的。
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
