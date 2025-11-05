# Towns Chat History Bot

Instant conversation recaps for busy Towns spaces.

## Overview

Towns Chat History Bot listens in any channel or thread you invite it to, then delivers on-demand summaries via `/summarize`. Each report highlights decisions, action items with mention-ready `<@userId>` owners, open questions, and sentiment shifts so teams can align quickly without rereading entire conversations.

## Features

- **Conversation capture**: records messages, edits, and deletions so recaps reflect the latest state.
- **Slash command summaries**: `/summarize [timeframe]` gathers context for a channel or thread; defaults to the last 24 hours or the whole thread when run inside one.
- **Structured output**: every summary starts with a short title of six words or fewer, calls out key themes, and ends with `Analyzed N messages.`
- **Accurate mentions**: owners and participants appear as full `<@userId>` tags ready to paste back into Towns.
- **Helpful fallbacks**: if the requested window is quiet, the bot summarizes the freshest messages it has stored instead.

## Commands

| Command | Description |
| --- | --- |
| `/summarize [timeframe]` | Generate a recap for the given duration (examples: `30m`, `24h`, `2d`, `last 3 hours`). In threads, omit the duration to summarize the entire thread. |
| `/help` | Show available commands and timeframe examples. |

## Summary Format

- Leading line: short descriptive title (six words or fewer).
- Sections covering key themes, action items with `<@userId>` owners, open questions, and notable sentiment signals.
- Final line: `Analyzed N messages.` with the actual count.

## Requirements

- [Bun](https://bun.sh/) runtime 1.0+.
- Towns bot credentials (`APP_PRIVATE_DATA`, `JWT_SECRET`).
- OpenAI API access (`OPENAI_API_KEY`), or a compatible Chat Completions endpoint.

## Setup

1. Copy environment template:
   ```bash
   cp .env.sample .env
   ```
2. Fill in required variables (see below).
3. Install dependencies:
   ```bash
   bun install
   ```
4. Start the bot in watch mode:
   ```bash
   bun run dev
   ```
   Use `bun run start` for production.

## Environment Variables

| Variable | Required | Description |
| --- | --- | --- |
| `APP_PRIVATE_DATA` | Yes | Base64-encoded Towns app credentials for the bot. |
| `JWT_SECRET` | Yes | Secret used to verify webhook authenticity. |
| `OPENAI_API_KEY` | Yes | Token for the OpenAI-compatible endpoint used to build summaries. |
| `OPENAI_API_ENDPOINT` | No | Override the default `https://api.openai.com/v1/chat/completions`. |
| `OPENAI_SUMMARY_MODEL` | No | Preferred summarization model (defaults to `gpt-4o-mini`). |
| `OPENAI_MODEL` | No | Fallback model if no summary model is provided. |
| `PORT` | No | HTTP port for the webhook server (defaults to `5123`). |

## Development Notes

- The in-memory transcript store resets when the process restarts. For long-lived history, swap in persistent storage (e.g., SQLite, Redis, or Postgres).
- `/summarize` currently analyzes up to 400 stored messages. Older content is truncated with a note.
- Need to verify changes? Use `bun test`, `bun run lint`, or `bun run typecheck`.

## Deployment Tips

- Run on an always-on host so the in-memory cache stays warm between summaries.
- Secure the webhook endpoint behind HTTPS and ensure Towns can reach the exposed URL.
- Monitor OpenAI usage to stay within rate limits and quotas.
