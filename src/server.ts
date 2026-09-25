import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import { simulate } from './core/analysis.js';
import { ServiceError } from './core/errors.js';
import type { ErrorResponse, SimulationResponse } from './types.js';

/**
 * HTTP 层：只做单管水锤瞬变这一个内核。
 *
 *   POST /simulate  收管道几何 + 阀门关闭规律 JSON，回演化结果
 *   GET  /healthz   存活探针
 *
 * 不提供任何前端页面。
 */
export function buildServer(): FastifyInstance {
  const app = Fastify({
    logger: true,
    bodyLimit: 1024 * 1024,
  });

  app.get('/healthz', async () => ({ status: 'ok' }));

  app.post(
    '/simulate',
    async (
      req: FastifyRequest,
      reply: FastifyReply,
    ): Promise<SimulationResponse | ErrorResponse> => {
      try {
        const response = simulate(req.body);
        return reply.code(200).send(response);
      } catch (err) {
        return sendError(reply, err);
      }
    },
  );

  // 非法 JSON 等请求级错误也统一成结构化响应
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ServiceError) {
      return sendError(reply, err);
    }
    if (err.statusCode === 400 || err.validation) {
      const body: ErrorResponse = {
        error: {
          code: 'validation',
          message: err.message,
        },
      };
      return reply.code(400).send(body);
    }
    reqLogError(reply, err);
  });

  return app;
}

function sendError(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof ServiceError) {
    const status = err.code === 'limit' ? 422 : 400;
    return reply
      .code(status)
      .send({
        error: {
          code: err.code,
          message: err.message,
          ...(err.details ? { details: err.details } : {}),
        },
      });
  }
  return reqLogError(reply, err);
}

function reqLogError(reply: FastifyReply, err: unknown): FastifyReply {
  reply.log.error(err);
  return reply.code(500).send({
    error: { code: 'validation', message: '服务器内部错误' },
  });
}
