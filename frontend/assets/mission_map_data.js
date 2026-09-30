// PRAHARI Mission Map — static scenario data.
//
// DRDO station coordinates are real, public, city-level locations for
// well-known DRDO laboratories (verified via public search, not guessed) —
// approximate facility-city positions, not precise operational coordinates.
// The comm/ground-stations, the patrol trajectory, and the attack scenario
// are explicitly fictional/illustrative for this hackathon demo.

const DRDO_STATIONS = [
  { id: 'hq', name: 'DRDO Headquarters', city: 'New Delhi', lat: 28.6139, lng: 77.2090, type: 'HQ' },
  { id: 'ade', name: 'Aeronautical Development Establishment (ADE)', city: 'Bengaluru', lat: 12.9716, lng: 77.5946, type: 'LAB' },
  { id: 'gtre', name: 'Gas Turbine Research Establishment (GTRE)', city: 'Bengaluru', lat: 12.9550, lng: 77.6600, type: 'LAB' },
  { id: 'adrde', name: 'Aerial Delivery R&D Establishment (ADRDE)', city: 'Agra', lat: 27.1767, lng: 78.0081, type: 'LAB' },
  { id: 'itr', name: 'Integrated Test Range (ITR)', city: 'Chandipur, Odisha', lat: 21.4500, lng: 87.0200, type: 'TEST_RANGE' },
  { id: 'vrde', name: 'Vehicles R&D Establishment (VRDE)', city: 'Ahmednagar', lat: 19.0948, lng: 74.7480, type: 'LAB' },
];

// Fictional ground/communication stations along the illustrative patrol route.
const COMM_STATIONS = [
  { id: 'gcs-1', name: 'Ground Control Station Alpha', lat: 23.2599, lng: 77.4126, note: 'SIMULATED — primary C2 uplink' },
  { id: 'gcs-2', name: 'Ground Control Station Bravo', lat: 20.9320, lng: 77.7523, note: 'SIMULATED — relay / SATCOM backup' },
  { id: 'gcs-3', name: 'Ground Control Station Charlie', lat: 18.5204, lng: 75.9200, note: 'SIMULATED — recovery airfield link' },
];

// Illustrative patrol-loop trajectory over central India (explicitly NOT a
// real operational route). Altitude in feet; narrative ties each waypoint
// to the same telemetry/defense-layer vocabulary used in the Live Ops
// Console so the "issues" panel reads consistently across the product.
const TRAJECTORY = [
  { lat: 23.2599, lng: 77.4126, alt_ft: 0,     label: 'WP-0 · Launch (Bhopal AFS, simulated)', narrative: 'Illustrative departure point. Select Play to follow the planned route.' },
  { lat: 26.4499, lng: 80.3319, alt_ft: 12500, label: 'WP-1 · Climb-out', narrative: 'Planned climb to 12,500 ft along the north-eastern route leg.' },
  { lat: 22.5726, lng: 88.3639, alt_ft: 14000, label: 'WP-2 · Ingress', narrative: 'Planned level cruise at 14,000 ft toward the eastern corridor.' },
  { lat: 20.2961, lng: 85.8245, alt_ft: 14000, label: 'WP-3 · Scenario waypoint', narrative: 'Fictional scenario waypoint. Fault scenarios are controlled separately in the live engine panel; passing this point does not inject a fault.', isThreatZone: true },
  { lat: 21.4500, lng: 87.0200, alt_ft: 13500, label: 'WP-4 · Coastal turn', narrative: 'Turn toward the return corridor at a planned altitude of 13,500 ft.' },
  { lat: 21.1458, lng: 79.0882, alt_ft: 11000, label: 'WP-5 · Egress', narrative: 'Planned descent toward the western return corridor.' },
  { lat: 22.7196, lng: 75.8577, alt_ft: 4000,  label: 'WP-6 · Approach', narrative: 'Planned descent to 4,000 ft for the recovery approach.' },
  { lat: 23.2599, lng: 77.4126, alt_ft: 0,     label: 'WP-7 · Recovery (Bhopal AFS, simulated)', narrative: 'Planned recovery at the launch location. Route replay stops here until restarted.' },
];

// Multiple simulated threat TYPES against the aircraft's own systems (sensor
// integrity / mechanical / thermal) — NOT cross-border strike scenarios.
// Each reuses a real fault type already implemented in the Live Ops Console
// (src/server/server.py SimulationController + src/agent/orchestrator.py),
// so selecting one here has a genuine effect on the live simulation, not a
// scripted fake.
const ATTACK_TYPES = [
  {
    id: 'ew-denial',
    label: 'Sensor signal loss',
    faultType: 'sensor_dropout',
    description: 'Drop selected engine sensor readings to test missing-data handling and the safe-mode gate. This scenario does not simulate GPS.',
  },
  {
    id: 'thermal-damage',
    label: 'Thermal stress',
    faultType: 'thermal_shock',
    description: 'Raise engine temperatures to exercise the thermal-stress assessment and controller response.',
  },
  {
    id: 'lube-damage',
    label: 'Oil pressure loss',
    faultType: 'oil_leak',
    description: 'Reduce oil pressure and increase oil temperature to test lubrication-fault detection.',
  },
  {
    id: 'structural-stress',
    label: 'Vibration spike',
    faultType: 'vibration_spike',
    description: 'Increase engine vibration to test vibration-fault detection and controller response.',
  },
  {
    id: 'sensor-spoof',
    label: 'Sensor drift',
    faultType: 'sensor_drift',
    description: 'Introduce a gradual sensor bias to test trend monitoring and assessment consistency.',
  },
];

// Kept for the map's WP-3 narrative tie-in (first/default attack type).
const ATTACK_SCENARIO = {
  waypointIndex: 3, // WP-3 above
  label: 'SIMULATED THREAT ENCOUNTER — EW / GPS DENIAL',
  faultType: ATTACK_TYPES[0].faultType,
  description: ATTACK_TYPES[0].description,
};

if (typeof window !== 'undefined') {
  window.MISSION_MAP_DATA = { DRDO_STATIONS, COMM_STATIONS, TRAJECTORY, ATTACK_SCENARIO, ATTACK_TYPES };
}
