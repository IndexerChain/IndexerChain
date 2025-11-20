## Verifiable Online/Reliability Signals Design (Deterministic & Validated)

Goal: make online/reliability signals used for reward weighting fully verifiable and deterministic across all nodes, without trusting local, non-deterministic views.

### Constraints
- Determinism: all honest nodes must reach the same decision with the same inputs
- Verifiability: signals must be accompanied by proofs that validators can check
- Availability: if proofs are missing/unavailable, consensus must gracefully degrade (fallback)

### High-level approach (Phase 51+)
We introduce a canonical, epoch-scoped signals root published by an aggregator service (the existing Signaling Durable Object can serve this role), and only use signals from the previous epoch for weighting.

#### 1) Epoch signals aggregation
- Each eligible participant periodically sends signed heartbeats during epoch `e`:
  - Message: `addr || epochId || counter || timestamp || deviceHint`
  - Signature: by the wallet (or miner) key corresponding to `addr`
  - Transport: P2P → relayed to Signaling DO; or direct WebSocket to Signaling DO
- Aggregator computes per-address metrics for epoch `e`:
  - `online`: normalized 0..100 (e.g., based on heartbeat density and session duration)
  - `reliab`: normalized 0..100 (e.g., quorum score snapshots averaged in the epoch)
  - Additional fields can be added later (e.g., penalties)
- Aggregator publishes at end of epoch `e`:
  - `signalsRoot_e`: Merkle root over leaves:
    ```
    leaf = H("sig" || addr || epochId || online || reliab)
    ```
  - Optionally a signed summary:
    ```
    signedSummary = Sign(AGG_PUBKEY, epochId || signalsRoot_e || stats)
    ```
  - API: `GET /epoch-signals?e=epochId` → `{ epochId, signalsRoot, signedSummary? }`
  - API: `GET /epoch-signals/proof?e=epochId&addr=<addr>` → `{ leafData, proof[] }`

Notes:
- `AGG_PUBKEY` is a well-known public key embedded in the client (via env/params)
- If multi-region DOs exist, a quorum signature (N-of-M) design can be introduced later

#### 2) Block header & payout metadata wiring
- For block at time in epoch `e+1`, weight computation uses signals from epoch `e`
- Proposer includes in block header (optional at first; required after activation height):
  - `signalsRoot` (for epoch `e`)
- Coinbase payout metadata (already v2) remains the place to store recipients and base weights; signals are not re-stored redundantly there but can optionally include per-recipient `online`/`reliab` as hints for UI.

#### 3) Verification rules (validators)
Given block B at epoch `e+1` with header `signalsRoot_e`:
1. Fetch `signalsRoot_e` (or accept if present on-chain) and validate `signedSummary` with `AGG_PUBKEY` (if provided)
2. For any recipient whose effective weight uses `online`/`reliab`:
   - Fetch proof `GET /epoch-signals/proof?e=e&addr=a`
   - Verify Merkle proof against `signalsRoot_e`
   - Verify `epochId == e`
   - Use `online`/`reliab` from leaf to compute effective weight
3. If proof unavailable or invalid:
   - Fallback: treat `online = reliab = 0` for that address
   - This preserves liveness and determinism (proof-bearing addresses gain enhanced weight, others default)
4. Leader selection can safely begin to use weighted candidates once proofs are enforced; until then, continue equal-weight leader verification to avoid divergence.

#### 4) Activation strategy
- Phase 51: Add optional `signalsRoot` to header; keep equal-weight leader check; start publishing aggregator endpoints; begin embedding hints into UI
- Phase 52: Enforce proof requirement for using `online`/`reliab` in weight calculation (payout distribution). Without proof → signals zeroed
- Phase 53: Switch leader selection verification to use weighted candidates (with proven signals) for fully signal-aware proposer enforcement

#### 5) Security and abuse considerations
- Sybil/IP sharing: keep existing IP sharing weights and referral anti-abuse; proofs don’t override those, but complement them
- Clock skew: rely on epochId rather than raw timestamps
- DDoS: aggregator can rate limit and only accept signed heartbeats
- Privacy: heartbeats carry only minimal metadata; device hints should be locally hashed if used

#### 6) Failure modes and fallbacks
- Aggregator down / unreachable:
  - Validators still accept blocks; `signalsRoot` may be missing
  - All signals default to zero → weights degrade to balance-based and base weight only
- Partial proofs:
  - Only recipients with valid proofs gain non-zero online/reliab contributions

### Summary
This design makes online/reliability signals:
- Globally deterministic (previous-epoch only, single canonical root)
- Verifiable (Merkle proofs + aggregator signature)
- Backward compatible (graceful fallback to zero signals)
It enables future migration to fully weighted proposer enforcement once proofs are enforced.


