"""Regressions for measured fault assessment and responsive live estimates.

Run with: PYTHONPATH=src .venv/bin/python -m pytest tests/test_live_assessment.py
These tests construct an in-process server stack; they never mutate the running app.
"""

from __future__ import annotations

import importlib
from types import SimpleNamespace

import numpy as np
import pytest
import torch

from agent.orchestrator import DigitalTwinOrchestrator, SENSOR_NAMES


NOMINAL = {
    "rpm": 4535.4, "cht": 150.0, "egt": 667.7, "oil_temp": 96.4,
    "oil_pressure": 281.8, "fuel_flow": 8.3, "vibration_rms": 1.41,
    "map": 92.0, "afr": 13.8, "torque": 24.5, "crank_pos": 175.0,
    "coolant_temp": 82.0,
}
FAULT_CASES = [
    ("thermal_shock", "cht_over", {"cht": 225.0}),
    ("oil_leak", "oil_starvation", {"oil_pressure": 145.0, "cht": 186.0}),
    ("vibration_spike", "vibration_over", {"vibration_rms": 4.5, "cht": 186.0}),
    ("egt_over_demo", "egt_over", {"egt": 825.0, "cht": 186.0}),
]


@pytest.fixture(scope="module")
def live_stack():
    # Existing scripts can import server.py as either a module or a package.
    # Reuse that in-process stack without importing the file twice.
    module = importlib.import_module("server")
    stack = module if hasattr(module, "SimulationController") else importlib.import_module("server.server")
    old_threads = torch.get_num_threads()
    torch.set_num_threads(1)
    yield stack
    stack.sim.inject_fault(None)
    stack.orchestrator.reset_state()
    torch.set_num_threads(old_threads)


@pytest.fixture
def wrong_model_orchestrator(monkeypatch):
    """An overconfident model must not overrule contrary physical evidence."""
    from classifier import fault_classifier

    def always_vibration(_model, _window):
        return {
            "fault_class": "vibration_over", "confidence": 0.999,
            "probabilities": {
                "cht_over": 0.0003, "vibration_over": 0.999,
                "oil_starvation": 0.0003, "egt_over": 0.0004,
            },
        }

    monkeypatch.setattr(fault_classifier, "predict_fault_from_window", always_vibration)
    scales = SimpleNamespace(
        norm_min=torch.zeros(12),
        norm_max=torch.tensor([6000., 300., 1000., 200., 500., 30., 25., 150., 20., 50., 360., 150.]),
    )
    return DigitalTwinOrchestrator(pinn_model=scales, fault_classifiers=[object(), object(), object()])


def assessment_state(frame):
    return {
        "audited_telemetry": frame,
        "window_buffer": [dict(frame) for _ in range(40)],
        "audit_results": {"integrity_passed": True, "corrupted_fields": [], "imputed_fields": {}},
    }


def test_checkpoint_scalers_replace_the_degenerate_zero_one_input(live_stack):
    orch = live_stack.orchestrator
    assert orch.normalization_ready
    assert orch.normalization_source in {"pinn_checkpoint", "training_dataset"}
    np.testing.assert_allclose(orch.norm_min, live_stack.pinn_model.norm_min.cpu().numpy())
    np.testing.assert_allclose(orch.norm_max, live_stack.pinn_model.norm_max.cpu().numpy())
    norm = np.clip((np.array([NOMINAL[name] for name in SENSOR_NAMES]) - orch.norm_min)
                   / (orch.norm_max - orch.norm_min), 0, 1)
    assert ((norm > 0) & (norm < 1)).sum() >= 3, "Real readings must not collapse to a constant clipped input."


def test_real_critical_readings_survive_audit_but_missing_values_do_not():
    orch = DigitalTwinOrchestrator()
    frame = dict(NOMINAL, vibration_rms=7.0, oil_pressure=40.0, cht=float("nan"))
    result = orch.sensor_auditor_node({"raw_telemetry": frame, "window_buffer": [NOMINAL]})
    assert result["audited_telemetry"]["vibration_rms"] == 7.0
    assert result["audited_telemetry"]["oil_pressure"] == 40.0
    assert result["audit_results"]["corrupted_fields"] == ["cht"]
    assert result["audited_telemetry"]["cht"] == NOMINAL["cht"]


@pytest.mark.parametrize("_scenario,expected,overrides", FAULT_CASES)
def test_primary_fault_follows_measured_severity_not_model_confidence(
    wrong_model_orchestrator, _scenario, expected, overrides,
):
    result = wrong_model_orchestrator.fault_classifier_node(
        assessment_state(dict(NOMINAL, **overrides))
    )["fault_results"]
    assert result["predicted_fault"] == expected
    assert result["assessment_source"] == "sensor_thresholds"
    assert result["confidence"] == 0, "Threshold evidence is not a calibrated probability."
    assert result["evidence"][expected]["severity"] > 0
    assert result["evidence"][expected]["value"] in overrides.values()
    assert result["model_prediction"]["fault_class"] == "vibration_over"
    assert result["model_prediction"]["confidence"] > 0.99


def test_healthy_readings_do_not_inherit_a_model_fault_or_fake_98_percent(wrong_model_orchestrator):
    result = wrong_model_orchestrator.fault_classifier_node(assessment_state(NOMINAL))["fault_results"]
    assert result["predicted_fault"] == "nominal"
    assert result["assessment_source"] == "nominal"
    assert result["confidence"] != 0.98
    assert all(item["severity"] == 0 for item in result["evidence"].values())


def test_imputed_hot_reading_is_marked_unavailable_instead_of_a_new_thermal_fault():
    orch = DigitalTwinOrchestrator()
    state = assessment_state(dict(NOMINAL, cht=260.0))
    state["audit_results"] = {
        "integrity_passed": False, "corrupted_fields": ["cht"], "imputed_fields": {"cht": 260.0},
    }
    result = orch.fault_classifier_node(state)["fault_results"]
    assert result["assessment_source"] == "sensor_unavailable"
    assert result["predicted_fault"] == "sensor_unavailable"
    assert result["evidence"]["cht_over"]["value"] is None
    assert result["evidence"]["cht_over"]["severity"] == 0


def _run_live(live_stack, scenario, frames=100):
    live_stack.sim.inject_fault(scenario)
    live_stack.orchestrator.reset_state()
    payloads = []
    for _ in range(frames):
        raw = live_stack.sim.step()
        payload = live_stack.orchestrator.process_telemetry_frame(raw, cycle=live_stack.sim.cycle)
        payloads.append(payload)
        action = payload["drl_action"]
        if action.get("shield_applied"):
            live_stack.sim.throttle = float(np.clip(live_stack.sim.throttle + action.get("delta_throttle", 0), 0.5, 0.9))
            live_stack.sim.mixture = float(np.clip(live_stack.sim.mixture + action.get("delta_mixture", 0) * 1.5, 12, 15))
    return payloads


def test_live_scenarios_have_distinct_faults_and_health_sensitive_remaining_life(live_stack):
    nominal = _run_live(live_stack, None)
    assert nominal[-1]["fault_archetype"] == "nominal"
    remaining = {}
    for scenario, expected, _ in FAULT_CASES:
        payloads = _run_live(live_stack, scenario)
        assert any(p["fault_archetype"] == expected for p in payloads[:60]), scenario
        assert payloads[-1]["fault_archetype"] == expected, scenario
        assert payloads[-1]["sensor_audit"]["passed"], "Injected physical faults are valid sensor readings."
        remaining[scenario] = payloads[-1]["rul_cycles"]
        assert remaining[scenario] < nominal[-1]["rul_cycles"], scenario
        assert payloads[-1]["rul_source"] in {"sensor_estimate", "pinn_model", "model_with_sensor_limit"}
    assert len(set(remaining.values())) >= 3, "Different measured stress must not produce the same frozen life estimate."


def test_live_clear_resumes_nominal_assessment_with_a_fresh_estimate(live_stack):
    fault = _run_live(live_stack, "vibration_spike")[-1]
    recovered = _run_live(live_stack, None)[-1]
    assert recovered["fault_archetype"] == "nominal"
    assert recovered["rul_cycles"] > fault["rul_cycles"]
    assert recovered["telemetry"]["vibration_rms"] < 2.5
