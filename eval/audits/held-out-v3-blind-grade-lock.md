# Held-out v3 blind-grade lock

This record freezes the exhaustive strategy-blind semantic grading of run
`run_c019d419734c6c5e` before the private answer-to-strategy map is opened.
At the time of this lock, the graders and the merging process had not used
`answer-map.private.json`; strategy identities remained sealed.

Provenance clarification recorded after the lock: the three graders were
isolated Codex reviewer agents, not human annotators. This clarification does
not change any grade, count, or hash below.

## Source integrity

- Dataset SHA-256: `8d6bf6999fcb7232e92633412f1eaf93be53a910dbfc1993f4fef7b6d49a7de3`
- Source report SHA-256: `d3edf008aec1ae88eebde9e3634c2827a80ec394ccacd5846030e9ec31b91aed`
- Source blind packets SHA-256: `527f3b4fba02feccbbb381e8413678816e45e07da9d970369fa54e92409e341d`
- Exhaustive bundle ID: `adjudication_978ed1d8eebc8957`
- Canonical packet-content SHA-256: `a337a3dfe5a6cdbc0adb6f164f262c08c5624378f855f817fa7920da0d2f3fe9`
- Exhaustive `packets.json` file SHA-256: `ea7bbef9403b7b0f261f9152ec8a8869fe30ddf4078e1a00601565a98b50f3cb`

## Independent reviewer batches

| Batch | Cases | Packets | Answers | Packet SHA-256 | Grade SHA-256 |
| --- | --- | ---: | ---: | --- | --- |
| 1 | `hv3-001`--`hv3-020` | 60 | 120 | `287c0fb422394dd8fb8a53bc381e0364df6efe49ab1232ec0dbf648322dec697` | `917982f56e548b6b6673928de2f6dced8acc01aa84669ffaca6be7e155ba7c2e` |
| 2 | `hv3-021`--`hv3-040` | 60 | 120 | `a8061c3dd6624d26728f4723cabd129d7860003bacd14b72777210c8f020b0af` | `ed992603bcd0b592b74de8921724bda70e3402c2d7639404301ce246e8add17c` |
| 3 | `hv3-041`--`hv3-060` | 60 | 120 | `5204ec049990b6d2144654a3bf261337edfa277fe12e2d736b48d3c4b40dc9d5` | `ee56a489b0681602617d0764136c43a5acd1bcefd2ae6b521895890cbcb68c3a` |

The merged blind grade sheet has SHA-256
`576808092658dba67edb8fd25681ac342cc086fc6083a0a4ac20e606c71c58c8`.
It contains exactly 180 unique packet IDs and 360 unique answer IDs, exactly
matching the exhaustive packet bundle. All critical verdicts are valid and
non-null: 304 anonymous answers pass and 56 fail.

This lock commits only anonymous judgments. Comparative results must be
derived after this record is committed by mechanically joining answer IDs to
the private strategy map.
