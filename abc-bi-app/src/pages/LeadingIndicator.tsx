import { useRef, useState } from 'react';
import {
  parseTimesheetV3, loadMarketData, buildPayload, computeBasicStats,
} from '../leading/dataPrep';
import type { ParsedTimesheet, MarketData, BasicStats } from '../leading/dataPrep';
import { runAnalysis } from '../leading/pyodideRunner';
import type { AnalysisOutput, IndicatorResult } from '../leading/pyodideRunner';

const DEPT_LABEL: Record<string, string> = {
  SASL10: '業一部', SASL20: '業二部', SAMM00: '行銷', CAFC00: '客服/財會',
};
const deptLabel = (d: string) => DEPT_LABEL[d] ?? d;

function sig(q: number) {
  if (q < 0.05) return { label: '顯著', cls: 'li-sig-strong' };
  if (q < 0.10) return { label: '邊際', cls: 'li-sig-weak' };
  return { label: '不顯著', cls: 'li-sig-none' };
}
function fmtEffect(r: IndicatorResult): string {
  if (r.effectLabel === 'OR') return `OR=${r.effect.toFixed(2)}`;
  if (r.effectLabel === 'rho') return `rho=${r.effect >= 0 ? '+' : ''}${r.effect.toFixed(2)}`;
  return `${r.effectLabel}=${r.effect.toFixed(1)}`;
}
const money = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 0 });

/** Build the plain-language verdict sentence from the headline result. */
function buildVerdict(out: AnalysisOutput, scope: string, lag: number): { text: string; tone: string } {
  const h = out.headline;
  if (!h) return { text: '目前資料量還不足以判定領先指標,請累積更多月份。', tone: 'li-tone-grey' };
  const s = sig(h.q);
  const tone = h.q < 0.05 ? 'li-tone-green' : h.q < 0.10 ? 'li-tone-amber' : 'li-tone-grey';
  let effect = '';
  if (h.effectLabel === 'OR') {
    const pct = Math.round((h.effect - 1) * 100);
    effect = `客戶該指標每增加 1 單位,下個月營收提高的勝算 ${pct >= 0 ? '提高' : '降低'} ${Math.abs(pct)}%`;
  } else if (h.effectLabel === 'rho') {
    effect = `與未來營收呈${h.effect >= 0 ? '正' : '負'}相關 (rho=${h.effect.toFixed(2)})`;
  }
  let q = '';
  if (out.quartiles && out.quartiles.points.length >= 2) {
    const pts = out.quartiles.points;
    const lo = pts[0], hi = pts[pts.length - 1];
    const ratio = lo.prob > 0 ? (hi.prob / lo.prob).toFixed(1) : '—';
    q = ` 拜訪量最高 (${hi.label}) 的客戶提高機率約 ${(hi.prob * 100).toFixed(0)}%,是最低 (${lo.label}) 的 ${ratio} 倍。`;
  }
  const text =
    `在【${scope}】,最能領先預測「下 ${lag} 個月客戶營收提高」的行動是「${h.x}」。` +
    `${effect}(p=${h.p.toFixed(4)},多重比較校正後 ${s.label})。${q}`;
  return { text, tone };
}

export function LeadingIndicator() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedTimesheet | null>(null);
  const [market, setMarket] = useState<MarketData | null>(null);
  const [dept, setDept] = useState<string | null>(null);
  const [lag, setLag] = useState(1);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [out, setOut] = useState<AnalysisOutput | null>(null);
  const [stats, setStats] = useState<BasicStats | null>(null);
  const [showDetail, setShowDetail] = useState(false);

  const analyze = async (ps: ParsedTimesheet, mk: MarketData, scopeDept: string | null, theLag: number) => {
    const lags = theLag === 2 ? [2, 1] : [1, 2];
    const payload = buildPayload(ps, mk, scopeDept, lags);
    const result = await runAnalysis(payload, (m) => setStatus(m));
    setOut(result);
    setStats(computeBasicStats(ps, mk, scopeDept, theLag));
  };

  const run = async () => {
    if (!file) { setError('請先上傳 Timesheet 檔案'); return; }
    setError(null); setOut(null); setRunning(true);
    try {
      setStatus('解析 Timesheet(拜訪紀錄)…');
      const ps = await parseTimesheetV3(file);
      if (ps.visits.length === 0) throw new Error('Timesheet 沒有可解析的拜訪紀錄。');
      setStatus('讀取已上傳的營收 / 成本…');
      const mk = await loadMarketData();
      if (mk.periods.length === 0) throw new Error('找不到營收資料。請先在 Dashboard 上傳 ReportResult。');
      setParsed(ps); setMarket(mk); setDept(null);
      await analyze(ps, mk, null, lag);
      setStatus(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus(null);
    } finally {
      setRunning(false);
    }
  };

  const reanalyze = async (scopeDept: string | null, theLag: number) => {
    if (!parsed || !market) return;
    setDept(scopeDept); setLag(theLag); setRunning(true); setError(null);
    try { await analyze(parsed, market, scopeDept, theLag); setStatus(null); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setRunning(false); }
  };

  const scopeName = dept ? deptLabel(dept) : '全公司';
  const verdict = out ? buildVerdict(out, scopeName, lag) : null;

  return (
    <div className="li-page">
      <header className="li-header">
        <h1>Leading Indicator · 領先指標</h1>
        <p className="li-sub">目標:找出「本月哪一種拜訪行動」能<strong>領先</strong>帶動「未來客戶營收提高」。回歸運算內建於瀏覽器 (Python)。不影響既有 drill-down。</p>
      </header>

      {/* Upload + controls */}
      <div className="li-controls">
        <input ref={fileRef} type="file" accept=".xlsx" style={{ display: 'none' }}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <button className="btn" type="button" onClick={() => fileRef.current?.click()}>📤 選擇 Timesheet</button>
        {file && <span className="li-file-name">{file.name}</span>}
        <button className="btn btn-primary" type="button" onClick={run} disabled={running || !file}>
          {running ? '運算中…' : '▶ 分析'}
        </button>
        {status && <span className="li-status">{status}</span>}
      </div>

      {parsed && (
        <div className="li-filterbar">
          <span className="li-filter-label">部門</span>
          <div className="li-seg">
            <button className={dept === null ? 'active' : ''} onClick={() => reanalyze(null, lag)} disabled={running}>全公司</button>
            {parsed.depts.map((d) => (
              <button key={d} className={dept === d ? 'active' : ''} onClick={() => reanalyze(d, lag)} disabled={running}>{deptLabel(d)}</button>
            ))}
          </div>
          <span className="li-filter-label" style={{ marginLeft: 18 }}>領先期數</span>
          <div className="li-seg">
            <button className={lag === 1 ? 'active' : ''} onClick={() => reanalyze(dept, 1)} disabled={running}>下個月 (lag-1)</button>
            <button className={lag === 2 ? 'active' : ''} onClick={() => reanalyze(dept, 2)} disabled={running}>下下個月 (lag-2)</button>
          </div>
        </div>
      )}

      {error && <div className="li-error">⚠ {error}</div>}

      {/* 1. VERDICT banner — the one-glance conclusion */}
      {verdict && (
        <section className={`li-verdict ${verdict.tone}`}>
          <div className="li-verdict-tag">結論</div>
          <div className="li-verdict-text">{verdict.text}</div>
        </section>
      )}

      {/* 2. Basic-statistics KPI cards */}
      {stats && (
        <section className="li-kpis">
          <div className="li-kpi">
            <div className="li-kpi-label">本月拜訪次數 <span className="li-kpi-sub">({stats.refMonth}月)</span></div>
            <div className="li-kpi-value">{stats.totalVisits}</div>
          </div>
          <div className="li-kpi">
            <div className="li-kpi-label">本月拜訪天數</div>
            <div className="li-kpi-value">{stats.visitDays} <span className="li-kpi-sub">天</span></div>
          </div>
          <div className="li-kpi">
            <div className="li-kpi-label">涵蓋客戶數</div>
            <div className="li-kpi-value">{stats.customersVisited}</div>
          </div>
          <div className="li-kpi li-kpi-wide">
            <div className="li-kpi-label">拜訪最多的客戶</div>
            <div className="li-kpi-value li-kpi-name">{stats.topCustomer?.name ?? '—'}</div>
            <div className="li-kpi-sub">{stats.topCustomer ? `${stats.topCustomer.visits} 次` : ''}</div>
          </div>
          <div className="li-kpi li-kpi-wide">
            <div className="li-kpi-label">→ 該客戶下 {stats.lag} 月營收</div>
            {stats.topCustomerIncreased === null ? (
              <div className="li-kpi-value li-kpi-sub">尚無下月資料</div>
            ) : (
              <div className={`li-kpi-value ${stats.topCustomerIncreased ? 'li-up' : 'li-down'}`}>
                {stats.topCustomerIncreased ? '▲ 提高' : '▼ 未提高'}
                <div className="li-kpi-sub">{money(stats.topCustomerRevPrev)} → {money(stats.topCustomerRevNext)}</div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* 3. Leading-indicator card with quartile probability */}
      {out?.headline && out.quartiles && (
        <section className="li-card">
          <h2 className="li-card-title">📈 領先指標:{out.headline.x}</h2>
          <div className="li-card-sub">
            依「{out.quartiles.feature}」分位,客戶「{out.quartiles.y === 'revenue increased' ? '下月營收提高' : out.quartiles.y}」的預測機率
          </div>
          <div className="li-quartiles-bars">
            {out.quartiles.points.map((pt) => (
              <div className="li-qbar" key={pt.label}>
                <div className="li-qbar-fill" style={{ height: `${Math.max(6, pt.prob * 100 * 3)}px` }} />
                <div className="li-qbar-prob">{(pt.prob * 100).toFixed(0)}%</div>
                <div className="li-qbar-x">{pt.label}<br />({pt.x.toFixed(1)})</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 4. Multivariable regression model */}
      {out?.model && (
        <section className="li-card">
          <h2 className="li-card-title">📐 多變量回歸模型</h2>
          <div className="li-card-sub">
            邏輯回歸 · 結果變數 = 下 {out.model.lag} 月營收提高(1/0) · 控制各因子後,哪些行動仍顯著
          </div>
          <table className="li-model-table">
            <thead>
              <tr><th>預測因子</th><th>勝算比 OR</th><th>p 值</th><th>方向</th><th>顯著性</th></tr>
            </thead>
            <tbody>
              {out.model.features.map((f, i) => {
                const s = f.p < 0.05 ? { label: '顯著', cls: 'li-sig-strong' } : f.p < 0.10 ? { label: '邊際', cls: 'li-sig-weak' } : { label: '不顯著', cls: 'li-sig-none' };
                return (
                  <tr key={i}>
                    <td>{f.name}</td>
                    <td className={f.direction === 'up' ? 'li-up' : 'li-down'}>{f.or.toFixed(3)}</td>
                    <td>{f.p.toFixed(4)}</td>
                    <td>{f.direction === 'up' ? '↑ 正向' : '↓ 負向'}</td>
                    <td className={s.cls}>{s.label}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="li-model-fit">
            樣本 n={out.model.n} · 提高事件={out.model.events} ·
            {out.model.pseudoR2 != null && <> McFadden pseudo-R²={out.model.pseudoR2.toFixed(3)} ·</>}
            {' '}分類準確率={(out.model.accuracy * 100).toFixed(0)}%
          </div>
        </section>
      )}

      {/* 5. Collapsible full detail */}
      {out && out.results.length > 0 && (
        <section className="li-results">
          <button className="li-toggle" type="button" onClick={() => setShowDetail((v) => !v)}>
            {showDetail ? '▼ 隱藏全部檢定明細' : `▶ 顯示全部檢定明細 (${out.results.length} 項)`}
          </button>
          {showDetail && (
            <>
              <p className="li-note">⚠ 探索性:同時測多組假設,以「BH q 顯著 + 方向一致」為準。</p>
              <div className="li-table-wrap">
                <table className="li-table">
                  <thead>
                    <tr>
                      <th>X(本月行動)</th><th>Y(未來營收)</th><th>方法</th><th>lag</th>
                      <th>n</th><th>事件</th><th>效果</th><th>p</th><th>BH q</th><th>判定</th>
                    </tr>
                  </thead>
                  <tbody>
                    {out.results.map((r, i) => {
                      const s = sig(r.q);
                      return (
                        <tr key={i} className={r.q < 0.10 ? 'li-row-sig' : ''}>
                          <td>{r.x}</td><td>{r.y}</td><td>{r.method}</td><td>{r.lag}</td>
                          <td>{r.n}</td><td>{r.events}</td>
                          <td className={r.direction === 'up' ? 'li-up' : 'li-down'}>{fmtEffect(r)}</td>
                          <td>{r.p.toFixed(4)}</td><td>{r.q.toFixed(3)}</td>
                          <td className={s.cls}>{s.label}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
