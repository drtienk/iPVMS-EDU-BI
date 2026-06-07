// Python source executed inside Pyodide (numpy + scipy only).
// Receives `payload_json` in globals, returns a JSON string.
// Self-contained: logistic regression (uni + multivariable) via hand-rolled IRLS.

export const ANALYSIS_PY = String.raw`
import json
import numpy as np
from scipy import stats

def _logit_irls(Xmat, y, ridge=1e-6, iters=100):
    """IRLS logistic regression. Xmat includes intercept column.
    Returns (beta, se, loglik) or (None, None, None)."""
    n, k = Xmat.shape
    beta = np.zeros(k)
    for _ in range(iters):
        eta = np.clip(Xmat @ beta, -30, 30)
        p = 1.0 / (1.0 + np.exp(-eta))
        W = np.clip(p * (1 - p), 1e-9, None)
        XtWX = Xmat.T @ (Xmat * W[:, None]) + ridge * np.eye(k)
        z = Xmat @ beta + (y - p) / W
        try:
            beta_new = np.linalg.solve(XtWX, Xmat.T @ (W * z))
        except np.linalg.LinAlgError:
            return None, None, None
        if np.max(np.abs(beta_new - beta)) < 1e-9:
            beta = beta_new
            break
        beta = beta_new
    eta = np.clip(Xmat @ beta, -30, 30)
    p = 1.0 / (1.0 + np.exp(-eta))
    W = np.clip(p * (1 - p), 1e-9, None)
    try:
        cov = np.linalg.inv(Xmat.T @ (Xmat * W[:, None]) + ridge * np.eye(k))
    except np.linalg.LinAlgError:
        return None, None, None
    se = np.sqrt(np.clip(np.diag(cov), 0, None))
    ll = np.sum(y * np.log(np.clip(p, 1e-12, 1)) + (1 - y) * np.log(np.clip(1 - p, 1e-12, 1)))
    return beta, se, ll

def _uni_logit(x, y):
    x = np.asarray(x, float); y = np.asarray(y, float)
    sd = x.std()
    if sd == 0:
        return None, None
    xs = (x - x.mean()) / sd
    X = np.column_stack([np.ones(len(x)), xs])
    beta, se, _ = _logit_irls(X, y)
    if beta is None or se[1] == 0:
        return None, None
    wald = beta[1] / se[1]
    pval = 2 * (1 - stats.norm.cdf(abs(wald)))
    return float(np.exp(beta[1] / sd)), float(pval)

def _bh(pvals):
    m = len(pvals)
    order = np.argsort(pvals)
    q = np.empty(m); prev = 1.0
    for rank in range(m - 1, -1, -1):
        idx = order[rank]
        prev = min(prev, pvals[idx] * m / (rank + 1))
        q[idx] = min(prev, 1.0)
    return q

def run(payload):
    cols = payload['features']['columns']
    rows = payload['features']['rows']
    revrows = payload['revenue']
    lags = payload.get('lags', [1, 2])
    cum_cols = [c for c in payload.get('cumulativeColumns', []) if c in cols]

    rev = {}
    for code, m, amt in revrows:
        rev[(str(code), int(m))] = rev.get((str(code), int(m)), 0.0) + float(amt or 0)

    feat = {}; months = set()
    for r in rows:
        code = str(r[0]); m = int(r[1]); months.add(m)
        d = feat.setdefault((code, m), {})
        for j, c in enumerate(cols):
            d[c] = d.get(c, 0.0) + float(r[2 + j] or 0)
    months = sorted(months)

    def getf(code, m, col):
        return feat.get((code, m), {}).get(col, 0.0)
    def get_x(code, t, col, cum):
        return getf(code, t, col) + (getf(code, t - 1, col) if cum else 0.0)

    specs = [(c, c, False) for c in cols] + [('近2月累積 ' + c, c, True) for c in cum_cols]

    # ---- single-variable ranking ----
    results = []
    for (xlabel, col, cum) in specs:
        for L in lags:
            trans = [t for t in months if (t + L) in months]
            if not trans:
                continue
            X = []; Rcur = []; Rnext = []
            for t in trans:
                for code in set(c for (c, mm) in feat if mm == t):
                    x = get_x(code, t, col, cum)
                    if x <= 0:
                        continue
                    X.append(x); Rcur.append(rev.get((code, t), 0.0)); Rnext.append(rev.get((code, t + L), 0.0))
            X = np.array(X, float)
            if len(X) < 8 or len(np.unique(X)) < 3:
                continue
            Rcur = np.array(Rcur, float); Rnext = np.array(Rnext, float); n = len(X)
            y_inc = (Rnext > Rcur).astype(int)
            y_any = (Rnext > 0).astype(int)

            def add(yd, meth, ev, elab, eff, p, d):
                if p is None or (isinstance(p, float) and np.isnan(p)):
                    return
                results.append({'x': xlabel, 'y': yd, 'method': meth, 'lag': L, 'n': int(n),
                                'events': int(ev), 'effectLabel': elab, 'effect': float(eff),
                                'p': float(p), 'direction': d})
            for (yd, yv) in (('revenue increased', y_inc), ('any revenue', y_any)):
                ev = int(yv.sum())
                if ev >= 4 and (n - ev) >= 4:
                    orr, pv = _uni_logit(X, yv)
                    if orr is not None:
                        add(yd, 'logistic', ev, 'OR', orr, pv, 'up' if orr > 1 else 'down')
                    g1 = X[yv == 1]; g0 = X[yv == 0]
                    if len(g1) >= 3 and len(g0) >= 3:
                        try:
                            _, pmw = stats.mannwhitneyu(g1, g0, alternative='two-sided')
                            add(yd, 'Mann-Whitney', ev, 'mean(hit)-mean(miss)', float(g1.mean() - g0.mean()),
                                float(pmw), 'up' if g1.mean() > g0.mean() else 'down')
                        except Exception:
                            pass
            try:
                rho, prho = stats.spearmanr(X, Rnext)
                add('next revenue level', 'Spearman', int((Rnext > 0).sum()), 'rho', float(rho), float(prho),
                    'up' if rho > 0 else 'down')
            except Exception:
                pass

    if not results:
        return {'results': [], 'headline': None, 'quartiles': None, 'model': None, 'months': months}

    pvals = np.array([r['p'] for r in results])
    for r, q in zip(results, _bh(pvals)):
        r['q'] = float(q)
    results.sort(key=lambda r: r['p'])

    headline = None
    for r in results:
        if r['method'] == 'logistic' and r['y'] == 'revenue increased' and r['direction'] == 'up' and r['q'] < 0.10:
            headline = r; break
    if headline is None:
        up = [r for r in results if r['direction'] == 'up']
        headline = sorted(up, key=lambda r: r['q'])[0] if up else results[0]

    # ---- quartile predicted-probability for headline ----
    quartiles = None
    try:
        col = None; cum = False
        for (xl, c, cm) in specs:
            if xl == headline['x']:
                col = c; cum = cm; break
        L = headline['lag']; trans = [t for t in months if (t + L) in months]
        X = []; Yv = []
        for t in trans:
            for code in set(c for (c, mm) in feat if mm == t):
                x = get_x(code, t, col, cum)
                if x <= 0:
                    continue
                X.append(x)
                if headline['y'] == 'any revenue':
                    Yv.append(1 if rev.get((code, t + L), 0.0) > 0 else 0)
                else:
                    Yv.append(1 if rev.get((code, t + L), 0.0) > rev.get((code, t), 0.0) else 0)
        X = np.array(X, float); Yv = np.array(Yv, int)
        sd = X.std(); mu = X.mean()
        Xd = np.column_stack([np.ones(len(X)), (X - mu) / sd])
        beta, _, _ = _logit_irls(Xd, Yv.astype(float))
        if beta is not None:
            pts = []
            for qt in (25, 50, 75, 90):
                xv = float(np.percentile(X, qt))
                etav = beta[0] + beta[1] * ((xv - mu) / sd)
                pts.append({'label': 'P' + str(qt), 'x': xv, 'prob': float(1 / (1 + np.exp(-np.clip(etav, -30, 30))))})
            quartiles = {'feature': headline['x'], 'y': headline['y'], 'points': pts}
    except Exception:
        quartiles = None

    # ---- multivariable model: lag-1, outcome = revenue increased ----
    model = None
    try:
        L = 1
        trans = [t for t in months if (t + L) in months]
        obs = [(code, t) for t in trans for code in set(c for (c, mm) in feat if mm == t)]
        y = np.array([1 if rev.get((c, t + L), 0.0) > rev.get((c, t), 0.0) else 0 for (c, t) in obs], int)
        events = int(y.sum()); n = len(y)
        if events >= 6 and n - events >= 6:
            # rank candidate specs by univariate p on this common sample
            cand = []
            for (xl, col, cum) in specs:
                xv = np.array([get_x(c, t, col, cum) for (c, t) in obs], float)
                if xv.std() == 0 or len(np.unique(xv)) < 3:
                    continue
                orr, pv = _uni_logit(xv, y.astype(float))
                if orr is not None:
                    cand.append((pv, xl, xv))
            cand.sort(key=lambda z: z[0])
            # drop near-duplicate predictors (corr > 0.85 with an already chosen one)
            kmax = int(np.clip(events // 8, 1, 4))
            chosen = []
            for (pv, xl, xv) in cand:
                if len(chosen) >= kmax:
                    break
                dup = any(abs(np.corrcoef(xv, c2)[0, 1]) > 0.85 for (_, c2) in chosen)
                if not dup:
                    chosen.append((xl, xv))
            if chosen:
                names = [c[0] for c in chosen]
                Xraw = np.column_stack([c[1] for c in chosen]).astype(float)
                mu = Xraw.mean(axis=0); sd = Xraw.std(axis=0); sd[sd == 0] = 1
                Xs = (Xraw - mu) / sd
                Xd = np.column_stack([np.ones(n), Xs])
                beta, se, ll = _logit_irls(Xd, y.astype(float))
                # null model loglik
                pbar = y.mean()
                ll0 = n * (pbar * np.log(max(pbar, 1e-12)) + (1 - pbar) * np.log(max(1 - pbar, 1e-12)))
                if beta is not None:
                    feats = []
                    for i, nm in enumerate(names):
                        b_std = beta[i + 1]; s_std = se[i + 1]
                        wald = b_std / s_std if s_std > 0 else 0
                        pv = 2 * (1 - stats.norm.cdf(abs(wald)))
                        orr = float(np.exp(b_std / sd[i]))
                        feats.append({'name': nm, 'coef': float(b_std / sd[i]), 'or': orr,
                                      'p': float(pv), 'direction': 'up' if orr > 1 else 'down'})
                    eta = np.clip(Xd @ beta, -30, 30); p = 1 / (1 + np.exp(-eta))
                    acc = float(np.mean((p >= 0.5).astype(int) == y))
                    mcf = float(1 - ll / ll0) if ll0 != 0 else None
                    model = {'lag': L, 'y': 'revenue increased', 'n': n, 'events': events,
                             'pseudoR2': mcf, 'accuracy': acc, 'features': feats}
    except Exception:
        model = None

    return {'results': results, 'headline': headline, 'quartiles': quartiles, 'model': model, 'months': months}

_out = run(json.loads(payload_json))
json.dumps(_out)
`;
