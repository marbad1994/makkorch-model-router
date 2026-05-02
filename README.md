# makkorch-model-router

A local model orchestration router for Codemakk and OpenAI-compatible coding clients.

`orchmakk-model-router` provides a single OpenAI-compatible API endpoint and routes coding requests to the best configured model for the task. It is built to balance quality, speed, cost, local/free model preference, provider availability, and previous model reliability.

The router is designed first for **Codemakk**, a controlled coding workbench with explicit file/context selection, router-backed model access, token preflight estimates, per-session stats, full-file and unified-diff edit flows, diff preview, checkpoints, and undo.

Cline and other OpenAI-compatible tools can also connect to the router, but Codemakk is the primary target.

```text
Codemakk / compatible client
↓
OpenAI-compatible router
↓
Task classification
↓
Routing intent parsing
↓
Model scoring
↓
Fallback chain
↓
Provider execution
↓
Validation / repair
↓
Response back to client
```

---

## Why This Exists

Coding assistants are most useful when they are predictable, observable, and easy to steer.

Instead of sending every prompt to one fixed model, `orchmakk-model-router` acts as a local orchestration layer. It can use cheaper, faster, or local models for simple work and escalate to stronger models only when the task requires it.

The router is not just a proxy. It is a decision layer between your coding client and your model providers.

---

## Core Features

- OpenAI-compatible `/v1/chat/completions` endpoint
- Works with Codemakk as the main coding client
- Compatible with Cline and other OpenAI-compatible clients
- Registry-based model configuration
- Automatic task classification
- Header-based routing profiles
- Model scoring based on task, speed, cost, quality, reliability, and locality
- Fallback chains when models fail or produce suspicious output
- Streaming responses with idle timeouts
- Optional longer timeout windows when a provider indicates reasoning/thinking activity
- Output validation for incomplete or truncated code
- Output sanitization for reasoning leaks and exact-output requests
- Live task context files for fallback and repair attempts
- Per-run token, latency, status, and model usage logging
- Provider abstraction for local and remote providers

---

## Compatible Providers

- nvidia both old & new api
- antrohpic through bedrock or direct
- lmstudio

## Primary Client: Codemakk

`orchmakk-model-router` is designed to pair with Codemakk.

Codemakk is a controlled coding workbench that aims to be simpler and more predictable than heavy autonomous coding agents. The intended workflow is explicit: choose context, ask for changes, inspect diffs, then apply.

Typical Codemakk flow:

```text
codemakk
/session new fix-router-streaming
/model auto-balanced
/profile balanced
/add src/router/executeChain.ts
/ask fix the streaming idle timeout
/diff
/apply
/stats
```

The router provides the model endpoint behind that workflow.

---

## OpenAI-Compatible API

Default server:

```text
http://localhost:8787
```

Base URL for clients:

```text
http://localhost:8787/v1
```

Main endpoint:

```text
POST /v1/chat/completions
```

Model listing endpoint:

```text
GET /v1/models
```

Health endpoint:

```text
GET /health
```

---

## Routing Overview

Each request goes through the same high-level flow:

```text
incoming request
→ classify task
→ parse routing intent
→ filter unavailable models
→ score eligible models
→ build fallback chain
→ execute selected provider
→ validate output
→ repair or fallback if needed
→ return response
```

The router chooses a model using both the request content and the routing profile.

---

## Task Classification

The router classifies prompts into task types such as:

- `small_edit`
- `implementation`
- `architecture`
- `debugging`
- `refactor`
- `testing`
- `docs`

This matters because different models are good at different jobs.

For example:

```text
Fix this TypeScript error
→ debugging

Create a complete React website
→ implementation

Design the architecture for a distributed model router
→ architecture

Rewrite this helper without changing behavior
→ refactor
```

---

## Routing Profiles

Routing intent can be controlled with headers.

Supported headers:

```text
x-router-profile
x-router-speed
x-router-local-preference
x-router-allow-paid
```

### Profiles

| Profile | Purpose |
|---|---|
| `balanced` | Default quality/speed/cost tradeoff |
| `fast` | Prefer lower latency models |
| `free-first` | Prefer local/free models |
| `deep` | Prefer stronger models for hard tasks |

### Recommended Defaults

General use:

```text
x-router-profile: balanced
x-router-speed: 4
x-router-local-preference: false
```

Large or difficult coding tasks:

```text
x-router-profile: deep
x-router-speed: 3
x-router-local-preference: false
```

Small edits:

```text
x-router-profile: fast
x-router-speed: 8
x-router-local-preference: true
```

Free/local preference:

```text
x-router-profile: free-first
x-router-speed: 6
x-router-local-preference: true
x-router-allow-paid: false
```

---

## Virtual Router Models

The router exposes virtual model names to clients. These are routing modes, not direct provider model IDs.

Examples:

```text
auto-balanced
auto-fast
auto-free-first
auto-deep
```

Your project may also expose compatibility aliases such as:

```text
auto-cline-balanced
auto-cline-fast
auto-cline-free-first
auto-cline-deep
```

The virtual model controls routing behavior. The actual provider model is selected by the scoring engine.

---

## Model Registry

Models are configured in:

```text
src/config/models.ts
src/config/registry.ts
```

Each registry entry describes model behavior:

```ts
{
  id: "provider-model-id",
  provider: "nvidia",
  quality: 4,
  speed: 7,
  cost: 1,
  latency: 5,
  local: false,
  strengths: ["implementation", "coding", "fast_reasoning"]
}
```

The router uses this metadata to score models for each request.

---

## Providers

Providers live in:

```text
src/providers/
```

Current provider categories may include:

- LM Studio / local OpenAI-compatible models
- Claude through Bedrock
- NVIDIA OpenAI-compatible models
- Other OpenAI-compatible providers, if configured

Provider registration is handled in:

```text
src/providers/index.ts
```

The router only scores models whose provider is configured and whose registry entry is enabled.

---

## Streaming

The router supports OpenAI-compatible SSE streaming.

Request:

```json
{
  "model": "auto-balanced",
  "stream": true,
  "messages": [
    {
      "role": "user",
      "content": "Write three short sentences about model routing."
    }
  ]
}
```

The router responds with OpenAI-compatible chunks:

```text
data: {"choices":[{"delta":{"content":"..."}}]}

data: [DONE]
```

---

## Streaming Timeouts

Streaming uses idle timeouts rather than total runtime timeouts.

That means a long response can run for several minutes as long as the provider is still producing output or activity.

Normal idle timeout:

```env
STREAM_IDLE_TIMEOUT_MS=30000
```

Thinking/reasoning idle timeout:

```env
STREAM_THINKING_IDLE_TIMEOUT_MS=120000
```

Provider-specific overrides:

```env
STREAM_IDLE_TIMEOUT_NVIDIA_MS=30000
STREAM_THINKING_IDLE_TIMEOUT_NVIDIA_MS=120000

STREAM_IDLE_TIMEOUT_CLAUDEBEDROCK_MS=45000
STREAM_THINKING_IDLE_TIMEOUT_CLAUDEBEDROCK_MS=120000

STREAM_IDLE_TIMEOUT_LMSTUDIO_MS=30000
STREAM_THINKING_IDLE_TIMEOUT_LMSTUDIO_MS=60000
```

Resolution order:

```text
model-specific override
→ provider-specific override
→ global default
```

---

## Non-Streaming Timeouts

Non-streaming calls use a total timeout.

```env
MODEL_TIMEOUT_MS=240000
```

Optional model/provider overrides can also be used depending on your configuration.

---

## Output Validation

The router validates model output before accepting it.

It can reject suspicious outputs such as:

- Empty responses
- Unclosed code fences
- Incomplete code blocks
- Responses ending mid-line or mid-expression
- Placeholder text like `rest unchanged`
- `omitted for brevity`
- `continue in next message`
- Truncation markers

This is especially important for full-file edits.

---

## Output Sanitization

The router includes a sanitizer for common reasoning leaks and exact-output tests.

For example, if a model returns something like:

```text
The user wants me to say a specific phrase...
Final Output:
hello world
```

The sanitizer can reduce that to:

```text
hello world
```

Exact-output prompts are also handled:

```text
Say exactly: benchmark passed.
```

Expected response:

```text
benchmark passed.
```

---

## Repair and Continuation

When streaming output appears incomplete, the router can ask the same model to continue from where it stopped.

Enable repair:

```env
ENABLE_STREAM_REPAIR=true
STREAM_REPAIR_MAX_ATTEMPTS=1
```

Repair flow:

```text
stream response
→ judge detects suspicious ending
→ router sends continuation request
→ model returns missing tail
→ router streams continuation
```

This is safer than silently switching models after partial output has already been sent to the client.

---

## Live Task Context

The router can maintain a live task context file for every request.

Enable it:

```env
ENABLE_TASK_CONTEXT=true
TASK_CONTEXT_DIR=data/task-context
TASK_CONTEXT_MAX_OUTPUT_CHARS=24000
TASK_CONTEXT_OUTPUT_TAIL_CHARS=8000
TASK_CONTEXT_MAX_EVENTS=300
```

Context files are updated while a model is working, not only after it fails.

They include:

- Original messages
- Task type
- Attempt history
- Current partial output
- Latest output tail
- Failure reasons
- Repair attempts
- Recent router events

This allows fallback models or repair prompts to continue with context instead of starting blind.

Example path:

```text
data/task-context/task_....json
```

---

## Token and Run Logging

Every model attempt can be logged to a JSONL ledger.

Enable ledger path:

```env
MODEL_RUN_LEDGER_PATH=data/model-runs.jsonl
```

Each record includes:

- Model key
- Provider
- Provider model ID
- Mode: `chat` or `stream`
- Status: `success`, `failed`, `rejected`, or `suspicious`
- Latency
- Token usage
- Whether token usage was estimated
- Input/output character counts
- Fallback index
- Judge reason or error message, if applicable

Example:

```json
{
  "mode": "stream",
  "modelKey": "deepseekPro",
  "provider": "nvidia",
  "providerModel": "provider-model-id",
  "status": "success",
  "latencyMs": 12450,
  "tokenUsage": {
    "inputTokens": 3200,
    "outputTokens": 840,
    "totalTokens": 4040,
    "estimated": false,
    "source": "raw.usage"
  }
}
```

If a provider does not report usage, the router estimates tokens using character count and marks the record as estimated:

```json
"estimated": true
```

Inspect recent runs:

```bash
tail -n 5 data/model-runs.jsonl | jq
```

---

## Message Optimizer

The message optimizer is intentionally conservative.

Enable it:

```env
ENABLE_MESSAGE_OPTIMIZER=true
```

It may prepend a small system instruction for code-output discipline, but it must not rewrite or compress the original prompt.

Safe behavior:

```text
prepend small stable system instruction
preserve original messages exactly
```

Unsafe behavior:

```text
compress prompts
remove newlines
summarize tool instructions
rewrite user messages
collapse code blocks
mutate file contents
```

This matters because coding clients often rely on exact formatting and protocol structure.

---

## Environment Example

```env
PORT=8787

# Message optimizer
ENABLE_MESSAGE_OPTIMIZER=true

# Timeouts
MODEL_TIMEOUT_MS=240000
STREAM_IDLE_TIMEOUT_MS=30000
STREAM_THINKING_IDLE_TIMEOUT_MS=120000

# Stream repair
ENABLE_STREAM_REPAIR=true
STREAM_REPAIR_MAX_ATTEMPTS=1

# Task context
ENABLE_TASK_CONTEXT=true
TASK_CONTEXT_DIR=data/task-context
TASK_CONTEXT_MAX_OUTPUT_CHARS=24000
TASK_CONTEXT_OUTPUT_TAIL_CHARS=8000
TASK_CONTEXT_MAX_EVENTS=300

# Run ledger
MODEL_RUN_LEDGER_PATH=data/model-runs.jsonl

# Local provider example
LMSTUDIO_URL=http://localhost:1234/v1

# NVIDIA provider example
NVIDIA_API_KEY=your_key_here
NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1
NVIDIA_MAX_TOKENS=16000

# Claude Bedrock example
AWS_REGION=eu-central-1
CLAUDE_MAX_TOKENS=16000
```

---

## Installation

Install dependencies:

```bash
npm install
```

Create your environment file:

```bash
cp .env.example .env
```

Edit `.env` with your provider settings.

---

## Running

Development mode:

```bash
npm run dev
```

Default server:

```text
http://localhost:8787
```

Health check:

```bash
curl http://localhost:8787/health
```

Expected:

```json
{
  "ok": true,
  "service": "cline-model-router"
}
```

If you renamed the service string in `src/index.ts`, this may show your local router name instead.

---

## Codemakk Setup

Use the router as Codemakk’s OpenAI-compatible model backend.

Typical settings:

```text
Base URL: http://localhost:8787/v1
Model: auto-balanced
Profile: balanced
Speed: 4
Local preference: false
```

Example session flow:

```text
/session new router-work
/model auto-balanced
/profile balanced
/add src/router/executeChain.ts
/ask improve the streaming idle timeout behavior
/diff
/apply
/stats
```

---

## Cline Compatibility

Cline can also connect to the router using its OpenAI-compatible provider option.

Cline settings:

```text
Provider: OpenAI Compatible
Base URL: http://localhost:8787/v1
Model: auto-balanced
```

Optional headers:

```text
x-router-profile: balanced
x-router-speed: 4
x-router-local-preference: false
```

If you still expose legacy Cline-style virtual model names, you can also use:

```text
auto-cline-balanced
auto-cline-fast
auto-cline-free-first
auto-cline-deep
```

---

## curl Tests

Non-streaming:

```bash
curl http://localhost:8787/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "x-router-profile: balanced" \
  -H "x-router-speed: 4" \
  -H "x-router-local-preference: false" \
  -d '{
    "model": "auto-balanced",
    "stream": false,
    "messages": [
      {
        "role": "user",
        "content": "Say exactly: router test worked."
      }
    ]
  }'
```

Streaming:

```bash
curl -N http://localhost:8787/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "x-router-profile: balanced" \
  -H "x-router-speed: 4" \
  -H "x-router-local-preference: false" \
  -d '{
    "model": "auto-balanced",
    "stream": true,
    "messages": [
      {
        "role": "user",
        "content": "Write five short sentences about model routing."
      }
    ]
  }'
```

---

## Project Structure

```text
src/
├── config/
│   ├── models.ts
│   └── registry.ts
├── providers/
│   ├── claudeBedrock.ts
│   ├── index.ts
│   ├── lmstudio.ts
│   └── nvidia.ts
├── router/
│   ├── buildFallbackChain.ts
│   ├── classifyTask.ts
│   ├── engine.ts
│   ├── executeChain.ts
│   ├── filterAvailableModels.ts
│   ├── judgeResult.ts
│   ├── messageOptimizer.ts
│   ├── outputSanitizer.ts
│   ├── parseIntent.ts
│   ├── pickBestModel.ts
│   ├── scoreModels.ts
│   ├── selectModel.ts
│   └── tokenUsage.ts
├── storage/
│   ├── modelPerformance.ts
│   ├── modelRunLedger.ts
│   ├── taskContext.ts
│   └── usageLedger.ts
├── types/
│   ├── modelScore.ts
│   ├── provider.ts
│   ├── router.ts
│   ├── routingDecision.ts
│   └── task.ts
└── index.ts
```

---

## Benchmarking Notes

For benchmarking, keep the request mode stable.

Recommended default benchmark headers:

```text
x-router-profile: balanced
x-router-speed: 4
x-router-local-preference: false
```

For harder prompts:

```text
x-router-profile: deep
x-router-speed: 3
x-router-local-preference: false
```

Track:

- Selected model
- Provider
- Latency
- Input tokens
- Output tokens
- Total tokens
- Cached tokens, if reported
- Whether tokens were estimated
- Whether fallback happened
- Whether repair happened
- Whether output was complete

Inspect the ledger:

```bash
tail -n 20 data/model-runs.jsonl | jq
```

---

## Design Principles

### Keep the Client in Control

Codemakk is designed around explicit context and explicit edits. The router should support that by being predictable, observable, and conservative.

### Do Not Mutate User Prompts Aggressively

Coding prompts often contain exact file contents, tool formats, and protocol-sensitive text. The router should not rewrite them.

### Prefer Repair Over Silent Streaming Fallback

Once streaming output has reached the client, fallback becomes risky. Repair/continuation is safer than pretending the previous stream never happened.

### Store Context While Work Is Happening

Task context should be updated during generation. If a model crashes, times out, or gets interrupted, the next model should already have useful state.

### Treat Token Data Honestly

If a provider reports usage, log it. If not, estimate it and mark it as estimated.

---

## Current Status

Implemented core capabilities:

- OpenAI-compatible API
- Codemakk-oriented routing layer
- Cline compatibility
- Task classification
- Header-based routing intent
- Model scoring
- Fallback chains
- Provider abstraction
- Streaming responses
- Adaptive idle timeouts
- Output validation
- Output sanitization
- Live task context
- Run and token logging

Planned improvements:

- Better provider-specific token accounting
- More robust prompt caching strategy where supported
- More detailed model reliability learning
- Better benchmark tooling
- Improved continuation repair
- Better model scoring based on historical outcomes

---

## License

MIT Liecense
