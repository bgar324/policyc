# Held-out v3 provider-schema incident

## Incident

The paid `held-out-v3` run `run_c019d419734c6c5e` began from the clean preregistration commit `d81862808f66b5fb80b5c3bcb2f06764a8a23f03`. The runtime was manually interrupted after detecting repeated HTTP 400 responses for synthetic function tools.

At interruption:

- 74 provider HTTP attempts had been persisted;
- 38 model responses completed;
- 36 requests failed before model execution with `invalid_function_parameters`;
- the 36 rejected requests reported no usage and incurred no recorded generation cost;
- completed responses used 506,483 input tokens and 39,558 output tokens;
- 15 built-in web searches were billed;
- recorded cost was `$0.29678315`, including `$0.15` of search-call fees.

The rejected cases were `hv3-005` through `hv3-010`, which declared Calendar, Gmail, or image-inspection function tools. Their raw 400 responses stated that strict mode required every property to appear in the JSON Schema `required` array.

## Root cause

`ToolDefinition.provider_dict()` unconditionally emitted `strict: true`. Several intentionally optional synthetic connector arguments were properties but were not required. OpenAI's function-calling contract requires every declared property to be required under strict mode; optional strict fields must instead allow `null`. The API therefore rejected the request before generation.

Official contract: <https://developers.openai.com/api/docs/guides/function-calling#strict-mode>

## Narrow runtime amendment

Commit `ea863d2746f45c778f6e22b5b0feb336871a391c` changes only provider serialization:

- schemas whose property set exactly equals their required-field set retain `strict: true`;
- schemas with intentionally optional properties emit `strict: false`;
- the dataset, request text, artifact context, obligation labels, compiler, compiled prompts, model, evaluator, grading rules, output cap, samples, concurrency, and cost limits remain unchanged.

The amendment passed 20 TypeScript tests, 89 Python tests, both type checkers, Ruff format/lint, and the 43-policy/32-edge graph validation. Offline inspection of the frozen manifest produced 42 function-tool definitions: 37 non-strict schemas with optional fields and five strict-compatible schemas.

## Resume accounting

The 36 terminal schema failures are preserved outside the active resume paths before re-dispatch. They are not model executions and are not counted among the authorized 360 model requests. The active run restores the 38 completed trials and their `$0.29678315` cost, then schedules the remaining 322 logical trials. Final reporting must disclose both the 360 model executions and the additional 36 rejected HTTP attempts.

This is a provider-adapter repair made before inspecting comparative held-out results. It does not tune compiler 0.7 or change the held-out cases. The source manifest remains immutable; this incident record bridges its original source commit to the runtime-amendment commit.
