import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { simulate } from './analysis.js';
import { baseRequest } from './validation.test.js';

/**
 * 用水力学规律钉死正确性：
 *  1. 近乎瞬时全关：阀门水头跃升逼近儒可夫斯基值 aV0/g；
 *  2. 波往返周期 ≈ 4L/a（由阀门第二次达到峰值的时刻观测）；
 *  3. 缓慢关闭（Tc ≫ 4L/a）峰值水头低于瞬时关闭；
 *  4. 全程流量协调：管内蓄量变化与两端进出流量之差对得上。
 */

const L = 1000;
const a = 1000;
const V0 = 1;
const g = 9.81;
const D = 0.5;
const H_R = 300;
const N = 20;

const J = (a * V0) / g; // 儒可夫斯基跃升 ≈ 101.94 m
const T_period = (4 * L) / a; // 往返周期 = 4 s

function instantRequest(frictionFactor = 0): Record<string, unknown> {
  const dt = L / (N * a); // 0.05 s
  return baseRequest({
    pipe: { length: L, diameter: D, waveSpeed: a, frictionFactor },
    reservoir: { head: H_R },
    initialVelocity: V0,
    // 关闭历时 = 一个时间步长：在首个推进层内恰好全关，属“近乎瞬时”
    closure: { kind: 'linear', closureTime: dt },
    discretization: { segments: N },
  });
}

describe('儒可夫斯基瞬时关闭跃升', () => {
  it('无摩擦近瞬时全关：峰值跃升在 1e-9 容差内等于 aV0/g', () => {
    const r = simulate(instantRequest(0));
    const s = r.summary;

    assert.ok(s.joukowskyRise > 0);
    assert.ok(
      Math.abs(s.peakRise - J) / J < 1e-9,
      `峰值跃升 ${s.peakRise} 未逼近儒可夫斯基值 ${J}`,
    );
    assert.ok(
      Math.abs(s.peakToJoukowskyRatio - 1) < 1e-9,
      `比值 ${s.peakToJoukowskyRatio} 未逼近 1`,
    );
    // 峰值水头 = 初态阀门水头 + 跃升
    assert.ok(Math.abs(s.peakHead - (H_R + J)) / (H_R + J) < 1e-9);
  });

  it('带摩阻时峰值跃升也在约 5% 内逼近 aV0/g（首波未受摩阻充分作用）', () => {
    const r = simulate(instantRequest(0.02));
    assert.ok(Math.abs(r.summary.peakToJoukowskyRatio - 1) < 0.05);
  });
});

describe('波往返周期 4L/a', () => {
  it('由阀门相邻跃升峰观测到的周期在一个时间步长内等于 4L/a', () => {
    const r = simulate(instantRequest(0));
    const w = r.wave;

    assert.ok(w.observedPeriod !== null, '应至少识别出两个跃升峰');
    assert.ok(Math.abs(w.theoreticalPeriod - T_period) < 1e-12);
    assert.ok(w.peakTimes!.length >= 2);

    const tol = r.grid.dt; // 允许一个离散步长的观测误差
    assert.ok(
      Math.abs(w.observedPeriod! - T_period) <= tol + 1e-9,
      `观测周期 ${w.observedPeriod} 偏离理论值 ${T_period}`,
    );
    // 第二次达到峰值的时刻 = 首峰时刻 + 4L/a
    assert.ok(
      Math.abs(w.peakTimes![1]! - (w.peakTimes![0]! + T_period)) <= tol + 1e-9,
    );
  });
});

describe('缓慢关闭峰值低于瞬时关闭', () => {
  it('关闭历时明显大于往返周期时，峰值跃升显著低于儒可夫斯基值', () => {
    const Tc = 5 * T_period; // 20 s ≫ 4 s
    const slow = simulate(
      baseRequest({
        closure: { kind: 'linear', closureTime: Tc },
        discretization: { segments: N },
      }),
    );
    const instant = simulate(instantRequest(0));

    assert.ok(slow.summary.peakHead < instant.summary.peakHead);
    assert.ok(slow.summary.peakRise < instant.summary.peakRise);
    // 缓关峰值明显低于瞬时：给一个有工程意义的严格界限
    assert.ok(
      slow.summary.peakToJoukowskyRatio < 0.2,
      `缓关比值 ${slow.summary.peakToJoukowskyRatio} 不够小`,
    );
  });
});

describe('流量协调（连续性）', () => {
  it('无摩擦：管内蓄量变化与两端进出流量差在 1e-10 容差内逐时一致', () => {
    const r = simulate(instantRequest(0));
    assert.ok(
      r.summary.continuityResidual < 1e-10,
      `连续性残差 ${r.summary.continuityResidual} 过大`,
    );
  });

  it('带摩阻：离散残差随网格加密按一阶收敛（边界管段摩阻离散误差）', () => {
    const coarse = simulate(
      (() => {
        const q = instantRequest(0.02) as { discretization: { segments: number } };
        q.discretization = { segments: 20 };
        return q;
      })(),
    );
    const fine = simulate(
      (() => {
        const q = instantRequest(0.02) as { discretization: { segments: number } };
        q.discretization = { segments: 80 };
        return q;
      })(),
    );
    // 一阶：步长缩 4 倍，残差约缩 4 倍；留足余量要求至少缩 2.5 倍
    assert.ok(
      fine.summary.continuityResidual <
        coarse.summary.continuityResidual / 2.5,
      `加密后残差未下降: ${coarse.summary.continuityResidual} → ${fine.summary.continuityResidual}`,
    );
  });

  it('首波抵达水库瞬间(t=L/a)：内点全管静止、普遍升压 ΔH_J；阀门流量恒为零；上游水头恒为库水位', () => {
    const req = instantRequest(0) as Record<string, unknown>;
    req.discretization = { segments: N, simulationTime: L / a };
    const r = simulate(req);
    const fs = r.valve.finalState;
    // 内点 1..N 流量为零（节点 0 在该瞬时已被水库边界“翻”成倒流）
    for (let i = 1; i < fs.flows.length; i++) {
      assert.ok(Math.abs(fs.flows[i]!) < 1e-8, `节点 ${i} 流量 ${fs.flows[i]} 非零`);
    }
    // 内点普遍升压一个儒可夫斯基量级
    for (let i = 1; i < fs.heads.length; i++) {
      assert.ok(Math.abs(fs.heads[i]! - (H_R + J)) < 1e-7);
    }
    // 阀门在全关后每个时刻流量严格为零
    for (const sample of r.valve.series.slice(1)) {
      assert.ok(Math.abs(sample.flow) < 1e-12);
    }
    // 上游水库水头任何时刻锁死
    assert.ok(Math.abs(fs.heads[0]! - H_R) < 1e-8);
  });

  it('带摩阻、长时间后：振荡沿程耗能，全管流速相对初态显著衰减', () => {
    const req = instantRequest(0.05) as Record<string, unknown>;
    // 50 个往返周期（200 s），摩擦耗散应把振荡流速压到初态的 1/4 以下
    req.discretization = { segments: 40, simulationTime: 50 * T_period };
    const r = simulate(req);
    const fs = r.valve.finalState;
    const maxV = Math.max(...fs.velocities.map(Math.abs));
    assert.ok(
      maxV < 0.25 * V0,
      `充分耗散后最大流速 ${maxV} 未明显衰减`,
    );
  });
});

describe('分段关闭覆盖', () => {
  it('分段线性数据给出的演化与等价线性关闭一致', () => {
    const dt = L / (N * a);
    const Tc = 4; // 与若干整数步对齐
    const piecewise = simulate(
      baseRequest({
        closure: {
          kind: 'piecewise',
          points: [
            { time: 0, opening: 1 },
            { time: Tc, opening: 0 },
          ],
        },
        discretization: { segments: N },
      }),
    );
    const linear = simulate(
      baseRequest({
        closure: { kind: 'linear', closureTime: Tc },
        discretization: { segments: N },
      }),
    );
    for (let i = 0; i < piecewise.valve.series.length; i++) {
      assert.ok(
        Math.abs(
          piecewise.valve.series[i]!.head - linear.valve.series[i]!.head,
        ) < 1e-10,
      );
      assert.ok(
        Math.abs(
          piecewise.valve.series[i]!.opening - linear.valve.series[i]!.opening,
        ) < 1e-12,
      );
    }
  });
});
