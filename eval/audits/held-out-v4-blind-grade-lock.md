# Held-out v4 blind-grade lock

This record freezes the exhaustive strategy-blind semantic grading of run
`run_16f13bd723767d59` before the private answer-to-strategy map is opened.
At the time of this lock, the graders and the merging process had not used
`answer-map.private.json`; strategy identities remained sealed. The three
graders were isolated Codex reviewer agents, not human annotators; their
transcripts were checked and every read was inside their own batch directory.

## Source integrity

- Dataset SHA-256: `197dee9fe2719f20848d81e5a4144218e217690b1a1c5c1f3aa2922d66efdfb1`
- Run: `run_16f13bd723767d59`, source commit `f8c74cdc28157af2c4daaf42b328c4724e032e11`, clean
- Source report SHA-256: `a2063f4b62b0b54d586745df5c1b8cee091b590a864464fbe0712fbed1650fb4`
- Source blind packets SHA-256: `5c9501a11f79bb3959a3094cedf37dde0dfca0b53017a60c714db3449ca5b0eb`
- Exhaustive bundle ID: `adjudication_0e67ed402be63860` (every pair with two completed answers)
- Exhaustive `packets.json` file SHA-256: `2e26fba7f4c046e68e374b288ba913211c810e40774c6906a88c5561f148bfcc`

Run outcome before grading: 360 executions, 339 completed, 21 failed (all
`incomplete` at the 2,048-token output cap, 11 compiled and 10 full), 0
ambiguous. 163 of 180 planned pairs have two completed answers (90.6%).

## Independent reviewer batches

| Batch | Cases | Packets | Answers | Packet SHA-256 | Grade SHA-256 |
| --- | --- | ---: | ---: | --- | --- |
| 1 | `hv4-001`–`hv4-020` | 49 | 98 | `3a286a0801cfb4eb04daa4db44453113eac0931311f43b65ac4b3f32ae2701f0` | `72ffd5feb0e0f69278267fac8b4d237dcf5c6cb90ac6c00133c14a3791c73741` |
| 2 | `hv4-021`–`hv4-040` | 58 | 116 | `b3319bf63f525a7efb3f464c7dcc4dcd5a19237015abc8734401b751ca018ec9` | `a1dd042d4cc8ecc1dcec359edb650683903288b4d3ae12e8770477063befe01f` |
| 3 | `hv4-041`–`hv4-060` | 56 | 112 | `1e77a73c2535e25a8cfb25cc36ccee8e8c25e90bf21a4040f6a5ead2e7af062a` | `cc5f629a4b92ec20fb02db1ba9a1495e5549ff09421e5a397d5a9b2ec7c4f46d` |

The merged blind grade sheet has SHA-256
`4d43480c7d71eba59e3e786f2c2ea7432ca9f87379c924477df54c074481a532`.
It contains exactly 163 unique packet IDs and 326 unique answer IDs, exactly
matching the exhaustive packet bundle. All critical verdicts are valid and
non-null: 243 anonymous answers pass and 83 fail; 0 ungradable.

This lock commits only anonymous judgments. Comparative results must be
derived after this record is committed by mechanically joining answer IDs to
the private strategy map.
