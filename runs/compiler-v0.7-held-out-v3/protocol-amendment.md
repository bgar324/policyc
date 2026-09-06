# Runtime amendment for run_c019d419734c6c5e

- Original manifest commit: `d81862808f66b5fb80b5c3bcb2f06764a8a23f03`
- Runtime amendment commit: `ea863d2746f45c778f6e22b5b0feb336871a391c`
- Interrupted state: 38 completed model responses, 36 pre-generation HTTP 400 schema rejections
- Recorded cost before repair: `$0.29678315`
- Behavioral/compiler/dataset changes: none
- Adapter change: emit `strict: false` for function schemas containing optional properties
- Official contract: <https://developers.openai.com/api/docs/guides/function-calling#strict-mode>

Rejected raw attempts and failed trial records are preserved under `quarantine-invalid-function-schema/` before the active resume paths are cleared. The resumed ledger restores the 38 completed responses and schedules 322 remaining model executions.
