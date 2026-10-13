# Doha vs Mumbai latency from Pakistan — 2026-10-11

Real measurements: Globalping probes in Pakistan -> gcping per-region endpoints, 3 rounds, 14 probes (fixed-line / ISP / data-centre networks; no mobile carriers unless listed).
First byte and total include the trip to the region; DNS / TCP / TLS mostly reflect Google's nearest edge. Ping = Google edge, not region.

| Region | Samples | Failures | DNS | TCP | TLS | First byte (median / p90) | Total (median / p90) | Edge ping | Max loss |
|---|---|---|---|---|---|---|---|---|---|
| Doha (me-central1) | 42 | 3 | 124 ms | 42 ms | 166 ms | 77 / 96 ms | 361 / 478 ms | 38.772 ms | 6.25% |
| Mumbai (asia-south1) | 42 | 3 | 120 ms | 42 ms | 166 ms | 522 / 984 ms | 900 / 1336 ms | 40.618 ms | 0% |
| Dammam (KSA reference) (me-central2) | 42 | 3 | 126 ms | 41 ms | 173 ms | 94 / 109 ms | 382 / 512 ms | 43.808 ms | 0% |

## Probes
- Islamabad | Virtury Cloud (AS150315)
- Islamabad | Virtury Cloud (AS150315)
- Karachi | Virtury Cloud (AS150315)
- Lahore | Pakistan Telecommunication Company (AS17557)
- Islamabad | Cyber Internet Services (AS9541)
- Arifwala | LEAP DIGITALS (AS154578)
- Lahore | Pakistan Telecommunication Company (AS17557)
- Faisalabad | Aero Cable (AS138910)
- Islamabad | Virtury Cloud (AS150315)
- Karachi | 2E TELEKOMUNIKASYON (AS209604)
- Islamabad | BrainStorm Network (AS136258)
- Karachi | SHARP TELECOM (AS9387)
- Islamabad | Nayatel (AS23674)
- Islamabad | Virtury Cloud (AS150315)
