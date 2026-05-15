import pino from 'pino';
import { env } from './env.js';

const isDev = env.NODE_ENV !== 'production';

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'radiant-arena-server' },
  transport: isDev
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss.l',
          ignore: 'pid,hostname,service',
        },
      }
    : undefined,
});
