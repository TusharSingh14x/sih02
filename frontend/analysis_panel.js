// Shared by live telemetry and replay so the entire analysis rail stays in sync.
const FAULT_NAMES = {
  nominal: 'No fault detected',
  cht_over: 'Cylinder overheating',
  vibration_over: 'Bearing vibration',
  oil_starvation: 'Oil starvation',
  egt_over: 'Exhaust temperature surge',
};
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const percent = (value) => finite(value) ? `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` : '—';
const duration = (cycles) => {
  const minutes = Math.round(Math.max(0, cycles) * 6);
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
};

export function renderAnalysis(data = {}, root = document) {
  const el = (id) => root.getElementById(id);
  const text = (id, value) => { if (el(id)) el(id).textContent = value; };
  const tone = (id, value) => { if (el(id)) el(id).dataset.tone = value; };
  const cycles = data.adjusted_rul ?? data.rul_cycles;
  const extension = data.extension_cycles;
  const hasRul = finite(cycles);
  const critical = hasRul && (data.mission_status === 'CRITICAL_RTB' || cycles <= 35 || (data.is_physically_valid === false && cycles <= 60));
  const caution = hasRul && (data.mission_status === 'ELEVATED_WEAR' || cycles <= 180);
  text('rul-number', hasRul ? Math.round(cycles) : '—');
  text('rul-status-badge', !hasRul ? 'Awaiting data' : critical ? 'Return to base' : caution ? 'Elevated wear' : 'Nominal');
  if (el('rul-status-badge')) el('rul-status-badge').className = `rul-status-pill ${!hasRul ? '' : critical ? 'status-crit' : caution ? 'status-warn' : 'status-ok'}`;
  if (el('rul-hero-card')) el('rul-hero-card').className = `rul-hero-card ${critical ? 'critical' : caution ? 'warning' : ''}`;
  text('rul-time-val', hasRul ? (data.sustain_flight_str || duration(cycles)).replace(/[⚠️]/gu, '').trim() : 'Awaiting telemetry');
  text('rul-extension', finite(extension) ? `+${extension.toFixed(1)} cycles estimated gain` : 'Gain unavailable');
  text('rul-time-ext', finite(extension) && extension > 0 ? `+${duration(extension)}` : '');
  text('fourier-residual', finite(data.fourier_residual) ? `${data.fourier_residual.toFixed(3)} °C` : '—');
  text('physical-gradient', finite(data.physical_gradient) ? `${data.physical_gradient.toFixed(3)} °C/cycle` : '—');
  text('fourier-adherence', data.is_physically_valid === true ? 'Within limits' : data.is_physically_valid === false ? 'Boundary drift' : 'Not available');
  tone('fourier-adherence', data.is_physically_valid === true ? 'good' : data.is_physically_valid === false ? 'warn' : 'neutral');

  text('fault-name', FAULT_NAMES[data.fault_archetype] || data.fault_archetype?.replace(/_/g, ' ') || 'Awaiting telemetry');
  text('fault-conf', finite(data.fault_confidence) ? `${percent(data.fault_confidence)} confidence` : '—');
  for (const fault of Object.keys(FAULT_NAMES).filter((name) => name !== 'nominal')) {
    const probability = data.fault_probabilities?.[fault];
    text(`fault-pct-${fault}`, percent(probability));
    if (el(`fault-bar-${fault}`)) el(`fault-bar-${fault}`).style.width = finite(probability) ? percent(probability) : '0%';
  }

  text('drl-text', data.drl_action?.recommendation || 'Waiting for an operating recommendation.');
  if (el('drl-shield-badge')) el('drl-shield-badge').style.display = data.drl_action?.shield_applied ? 'inline-flex' : 'none';
  text('defense-agreement', finite(data.fault_agreement_score) ? `${percent(data.fault_agreement_score)} · ${data.fault_ensemble_size ?? '—'} models` : '—');
  const mode = data.drl_action?.action_mode;
  text('defense-action-mode', !mode ? 'Not available' : mode === 'AUTONOMOUS_ACTION' ? 'Automatic' : 'Operator review');
  tone('defense-action-mode', !mode ? 'neutral' : mode === 'AUTONOMOUS_ACTION' ? 'good' : 'warn');
  const verified = data.integrity?.verified;
  text('defense-integrity', verified === true ? 'Server verified' : verified === false ? 'Verification failed' : 'Not verified');
  tone('defense-integrity', verified === true ? 'good' : verified === false ? 'bad' : 'neutral');
  text('defense-trend-risk', percent(data.trend_risk_score));
  tone('defense-trend-risk', data.trend_risk_score >= 0.66 ? 'bad' : data.trend_risk_score >= 0.34 ? 'warn' : 'neutral');
}
