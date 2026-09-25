import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildServer } from './server.js';

const validBody = {
  pipe: { length: 1000, diameter: 0.5, waveSpeed: 1000, frictionFactor: 0 },
  reservoir: { head: 300 },
  initialVelocity: 1,
  closure: { kind: 'linear', closureTime: 0.05 },
  discretization: { segments: 20 },
};

describe('HTTP 层', () => {
  let app: FastifyInstance;

  before(async () => {
    app = buildServer();
    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  it('GET /healthz 返回 ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { status: 'ok' });
  });

  it('POST /simulate 返回完整演化结果与摘要', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/simulate',
      payload: validBody,
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();

    assert.ok(body.summary);
    assert.ok(body.grid.courant === 1);
    assert.ok(body.summary.peakHead > 300);
    assert.ok(Math.abs(body.summary.peakToJoukowskyRatio - 1) < 1e-9);
    assert.ok(Array.isArray(body.valve.series));
    assert.ok(body.valve.finalState.heads.length === 21);
    assert.ok(body.wave.theoreticalPeriod === 4);
    assert.ok(body.friction.linearization === 'explicit-time-centered-tangent');
  });

  it('非法波速返回 400 + 结构化 validation 错误', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/simulate',
      payload: {
        ...validBody,
        pipe: { ...validBody.pipe, waveSpeed: -1 },
      },
    });
    assert.equal(res.statusCode, 400);
    const body = res.json();
    assert.equal(body.error.code, 'validation');
    assert.ok(typeof body.error.message === 'string' && body.error.message.length > 0);
  });

  it('缺字段返回结构化错误', async () => {
    const { reservoir: _omit, ...noReservoir } = validBody;
    const res = await app.inject({
      method: 'POST',
      url: '/simulate',
      payload: noReservoir,
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error.code, 'validation');
  });

  it('网格不贴格返回 grid 错误并带细节', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/simulate',
      payload: {
        ...validBody,
        discretization: { dt: 0.03 },
      },
    });
    assert.equal(res.statusCode, 400);
    const body = res.json();
    assert.equal(body.error.code, 'grid');
    assert.ok(body.error.details);
  });

  it('超步数上限返回 422 limit 错误', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/simulate',
      payload: {
        ...validBody,
        discretization: { segments: 20, maxSteps: 5 },
      },
    });
    assert.equal(res.statusCode, 422);
    assert.equal(res.json().error.code, 'limit');
  });

  it('非法 JSON 返回结构化错误而非 500', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/simulate',
      headers: { 'content-type': 'application/json' },
      payload: '{ not json',
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error.code, 'validation');
  });
});
