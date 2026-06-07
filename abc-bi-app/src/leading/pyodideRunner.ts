import { ANALYSIS_PY } from './analysisScript';

const PYODIDE_VERSION = 'v0.26.2';
const PYODIDE_CDN = `https://cdn.jsdelivr.net/pyodide/${PYODIDE_VERSION}/full/`;

// Minimal typing for the Pyodide object we use.
interface PyodideLike {
  loadPackage(names: string[]): Promise<void>;
  runPythonAsync(code: string): Promise<string>;
  globals: { set(name: string, value: unknown): void };
}

declare global {
  interface Window {
    loadPyodide?: (opts: { indexURL: string }) => Promise<PyodideLike>;
  }
}

let pyodidePromise: Promise<PyodideLike> | null = null;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

/** Lazily load Pyodide + numpy + scipy. Cached across calls. */
export async function getPyodide(onStatus?: (msg: string) => void): Promise<PyodideLike> {
  if (pyodidePromise) return pyodidePromise;
  pyodidePromise = (async () => {
    onStatus?.('Loading Python runtime (Pyodide)…');
    await loadScript(`${PYODIDE_CDN}pyodide.js`);
    if (!window.loadPyodide) throw new Error('Pyodide failed to initialise');
    const py = await window.loadPyodide({ indexURL: PYODIDE_CDN });
    onStatus?.('Loading numpy + scipy…');
    await py.loadPackage(['numpy', 'scipy']);
    return py;
  })();
  return pyodidePromise;
}

export interface IndicatorResult {
  x: string;
  y: string;
  method: string;
  lag: number;
  n: number;
  events: number;
  effectLabel: string;
  effect: number;
  p: number;
  q: number;
  direction: 'up' | 'down';
}

export interface ModelFeature {
  name: string;
  coef: number;
  or: number;
  p: number;
  direction: 'up' | 'down';
}

export interface RegressionModel {
  lag: number;
  y: string;
  n: number;
  events: number;
  pseudoR2: number | null;
  accuracy: number;
  features: ModelFeature[];
}

export interface AnalysisOutput {
  results: IndicatorResult[];
  headline: IndicatorResult | null;
  quartiles: {
    feature: string;
    y: string;
    points: { label: string; x: number; prob: number }[];
  } | null;
  model: RegressionModel | null;
  months: number[];
}

export interface AnalysisPayload {
  features: { columns: string[]; rows: (string | number)[][] };
  revenue: (string | number)[][];
  lags: number[];
  /** Columns for which a "this month + previous month" cumulative variant is also tested. */
  cumulativeColumns?: string[];
}

/** Run the leading-indicator statistical grid inside Pyodide. */
export async function runAnalysis(
  payload: AnalysisPayload,
  onStatus?: (msg: string) => void
): Promise<AnalysisOutput> {
  const py = await getPyodide(onStatus);
  onStatus?.('Running regressions in Python…');
  py.globals.set('payload_json', JSON.stringify(payload));
  const out = await py.runPythonAsync(ANALYSIS_PY);
  return JSON.parse(out) as AnalysisOutput;
}
