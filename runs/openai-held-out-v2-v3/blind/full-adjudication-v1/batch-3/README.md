# Blind adjudication bundle

Bundle: `adjudication_bdec78257ad23b62`

Packets: 46

Answers: 92

## Blinding rules

1. Read only `README.md`, `manifest.json`, `packets.json`, and a copy of `grades.template.json`.
2. Do not open the run report, trial files, compiler artifacts, private answer map, or private selection map.
3. Do not infer strategy identity from answer length, style, or ordering.
   Answer order is deterministic but strategy-blind.
4. Grade each answer independently before comparing the pair.

## Grade fields

- `criticalVerdict`: `pass`, `fail`, or `ungradable`.
- `failedCriticalObligationIds`: every failed ID from `criticalObligations`; use `refusal_expectation` or
  `tool_expectation` when those declared expectations fail.
- `rubricVerdict`: `pass`, `fail`, or `ungradable` for the supplied case rubric as a whole.
- `notes`: a concise, behavior-based explanation. Do not grade verbosity or style unless the rubric makes it relevant.

Treat missing, truncated, or genuinely ambiguous evidence as `ungradable`, never as a pass.
Save the completed sheet under a new filename; do not overwrite the template.
Return the completed grade sheet to the experiment owner.
The owner will join it to the private answer map only after grading is final.

Only inspect files inside this assigned batch directory. Observed tool evidence is limited to tool name, type, and status; grade required and forbidden tool behavior from that evidence.
