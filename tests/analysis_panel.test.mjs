import test from 'node:test';
import assert from 'node:assert/strict';
import { renderAnalysis } from '../frontend/analysis_panel.js';
import { telemetryStore } from '../frontend/telemetry_store.js';

function documentStub() {
  const nodes = new Map();
  return { getElementById(id) {
    if (!nodes.has(id)) nodes.set(id, { textContent: '', className: '', dataset: {}, style: {} });
    return nodes.get(id);
  } };
}
const sample = {
  telemetry: { cht: 150 }, adjusted_rul: 67, extension_cycles: 12.7,
  fourier_residual: 0.49, physical_gradient: -1.063, is_physically_valid: true,
  fault_archetype: 'vibration_over', fault_confidence: 0,
  fault_probabilities: { vibration_over: 0.67, egt_over: 0.33 },
  fault_agreement_score: 0.67, fault_ensemble_size: 3,
  drl_action: { recommendation: 'Maintain steady cruise', action_mode: 'SAFE_MODE', shield_applied: true },
  integrity: { verified: true }, trend_risk_score: 0.4,
};
test('missing telemetry never appears as a healthy sample reading', () => {
  const doc = documentStub(); renderAnalysis({}, doc);
  assert.equal(doc.getElementById('rul-number').textContent, '—');
  assert.equal(doc.getElementById('fourier-adherence').textContent, 'Not available');
  assert.equal(doc.getElementById('defense-integrity').textContent, 'Not verified');
  assert.equal(doc.getElementById('fault-pct-vibration_over').textContent, '—');
});
test('zero confidence is retained and omitted probabilities reset old bars', () => {
  const doc = documentStub(); renderAnalysis(sample, doc);
  assert.equal(doc.getElementById('fault-conf').textContent, '0% confidence');
  assert.equal(doc.getElementById('fault-bar-vibration_over').style.width, '67%');
  assert.equal(doc.getElementById('rul-status-badge').textContent, 'Elevated wear');
  assert.equal(doc.getElementById('defense-action-mode').textContent, 'Operator review');
  renderAnalysis({ fault_archetype: 'nominal', fault_confidence: 1 }, doc);
  assert.equal(doc.getElementById('fault-bar-vibration_over').style.width, '0%');
  assert.equal(doc.getElementById('drl-shield-badge').style.display, 'none');
});
test('zero life, invalid numbers, and minute rollover render correctly', () => {
  const doc = documentStub(); renderAnalysis({ adjusted_rul: 0 }, doc);
  assert.equal(doc.getElementById('rul-number').textContent, 0);
  assert.equal(doc.getElementById('rul-status-badge').textContent, 'Return to base');
  renderAnalysis({ adjusted_rul: 19.99, physical_gradient: NaN, fourier_residual: null }, doc);
  assert.equal(doc.getElementById('rul-time-val').textContent, '2h 00m');
  assert.equal(doc.getElementById('physical-gradient').textContent, '—');
  assert.equal(doc.getElementById('fourier-residual').textContent, '—');
});
test('replay preserves a complete independent analysis snapshot', () => {
  const frame = structuredClone(sample);
  telemetryStore.ingest(frame.telemetry, 10, frame);
  frame.drl_action.recommendation = 'Later recommendation';
  frame.integrity.verified = false;
  const snapshot = telemetryStore.getHistoricalFrame(10);
  const liveDoc = documentStub(); const replayDoc = documentStub();
  renderAnalysis(sample, liveDoc); renderAnalysis(snapshot, replayDoc);
  for (const id of ['rul-extension', 'fourier-residual', 'physical-gradient', 'fault-conf', 'drl-text', 'defense-agreement', 'defense-integrity', 'defense-trend-risk']) {
    assert.equal(replayDoc.getElementById(id).textContent, liveDoc.getElementById(id).textContent, id);
  }
});
