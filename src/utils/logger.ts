import { pino } from 'pino';
import { env } from '../config/env.js';

const isDev = env.NODE_ENV === 'development';

export const logger = pino({
  level: env.LOG_LEVEL,
  base: {
    service: 'radiant-tech-sect-bot',
    env: env.NODE_ENV,
  },
  redact: {
    paths: ['token', 'DISCORD_TOKEN', '*.token', 'authorization', 'password'],
    censor: '[REDACTED]',
  },
  ...(isDev
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss.l',
            ignore: 'pid,hostname,service,env',
          },
        },
      }
    : {}),
});

export type Logger = typeof logger;
