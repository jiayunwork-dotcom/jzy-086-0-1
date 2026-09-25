import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { simulate } from './analysis.js';
import { ServiceError } from './errors.js';

/** 标准无摩擦算例：L=1000 m, D=0.5 m, a=1000 m/s, V0=1 m/s。 */
export function baseRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    pipe: {
      length: 1000,
      diameter: 0.5,
      waveSpeed: 1000,
      frictionFactor: 0,
    },
    reservoir: { head: 300 },
    initialVelocity: 1,
    closure: { kind: 'linear', closureTime: 0.05 },
    discretization: { segments: 20 },
    ...overrides,
  };
}

export function expectServiceError(
  fn: () => unknown,
  code: string,
): ServiceError {
  try {
    fn();
  } catch (err) {
    assert.ok(
      err instanceof ServiceError,
      `期望 ServiceError，实际 ${String(err)}`,
    );
    assert.equal(err.code, code);
    return err;
  }
  assert.fail('期望抛出 ServiceError，但函数正常返回');
}

describe('输入校验：非法参数', () => {
  it('波速非正/非数判非法', () => {
    for (const waveSpeed of [0, -1000, NaN]) {
      expectServiceError(
        () => simulate(baseRequest({ pipe: { ...(baseRequest().pipe as object), waveSpeed } })),
        'validation',
      );
    }
  });

  it('管长非正判非法', () => {
    expectServiceError(
      () => simulate(baseRequest({ pipe: { ...(baseRequest().pipe as object), length: 0 } })),
      'validation',
    );
  });

  it('管径为负判非法', () => {
    expectServiceError(
      () => simulate(baseRequest({ pipe: { ...(baseRequest().pipe as object), diameter: -0.5 } })),
      'validation',
    );
  });

  it('关闭历时为负判非法', () => {
    expectServiceError(
      () => simulate(baseRequest({ closure: { kind: 'linear', closureTime: -1 } })),
      'validation',
    );
  });

  it('缺水库水头判非法', () => {
    const req = baseRequest();
    delete (req as { reservoir?: unknown }).reservoir;
    expectServiceError(() => simulate(req), 'validation');
  });

  it('缺初始流速判非法', () => {
    const req = baseRequest();
    delete (req as { initialVelocity?: unknown }).initialVelocity;
    expectServiceError(() => simulate(req), 'validation');
  });

  it('初始流速非正判非法', () => {
    expectServiceError(() => simulate(baseRequest({ initialVelocity: 0 })), 'validation');
  });

  it('分段规律不从全开开始判非法', () => {
    expectServiceError(
      () =>
        simulate(
          baseRequest({
            closure: {
              kind: 'piecewise',
              points: [
                { time: 0, opening: 0.8 },
                { time: 1, opening: 0 },
              ],
            },
          }),
        ),
      'validation',
    );
  });

  it('分段规律时间非严格递增判非法', () => {
    expectServiceError(
      () =>
        simulate(
          baseRequest({
            closure: {
              kind: 'piecewise',
              points: [
                { time: 0, opening: 1 },
                { time: 0.5, opening: 0.5 },
                { time: 0.5, opening: 0 },
              ],
            },
          }),
        ),
      'validation',
    );
  });
});

describe('网格贴格：库朗数必须恰为 1', () => {
  it('给定 dt 凑不出整数管段时报网格错误', () => {
    // L/(a·dt) = 1000/(1000·0.03) = 33.333…
    expectServiceError(
      () => simulate(baseRequest({ discretization: { dt: 0.03 } })),
      'grid',
    );
  });

  it('segments 与 dt 互相不吻合时报网格错误', () => {
    expectServiceError(
      () =>
        simulate(
          baseRequest({
            // N=20 要求 dt=0.05，故意给 0.04（对应 N=25）
            discretization: { segments: 20, dt: 0.04 },
          }),
        ),
      'grid',
    );
  });

  it('合法贴格网格（含整数倍模拟时长）库朗数恰为 1', () => {
    const r = simulate(
      baseRequest({ discretization: { dt: 0.05, simulationTime: 1.0 } }),
    );
    assert.ok(Math.abs(r.grid.courant - 1) < 1e-12);
    assert.equal(r.grid.segments, 20);
    assert.equal(r.grid.steps, 20);
  });

  it('模拟时长不是 dt 整数倍时报网格错误', () => {
    // dt=0.05；1.02/0.05 = 20.4，非整数
    expectServiceError(
      () =>
        simulate(
          baseRequest({
            discretization: { segments: 20, simulationTime: 1.02 },
          }),
        ),
      'grid',
    );
  });
});

describe('步数上限保护', () => {
  it('推进步数超过 maxSteps 时报 limit 错误终止，不陷入死循环', () => {
    expectServiceError(
      () =>
        simulate(
          baseRequest({
            discretization: { segments: 20, maxSteps: 10 },
          }),
        ),
      'limit',
    );
  });
});
