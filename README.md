# Towns Chronicle Bot

Instant conversation recaps for busy Towns spaces.

## Overview

Towns Chronicle Bot listens in any channel or thread you invite it to, then delivers on-demand summaries via `/summarize`. Each report highlights decisions, action items, and open questions so teams can align quickly without rereading entire conversations.

## Features

- **Conversation capture**: records messages, edits, and deletions so recaps reflect the latest state.
- **Slash command summaries**: `/summarize [timeframe]` gathers context for a channel or thread; defaults to the last 24 hours or the whole thread when run inside one.
- **Structured output**: every summary starts with a short title of six words or fewer, calls out key themes.
- **Helpful fallbacks**: if the requested window is quiet, the bot summarizes the freshest messages it has stored instead.

## Commands

| Command | Description |
| --- | --- |
| `/summarize [timeframe]` | Generate a recap for the given duration (examples: `30m`, `24h`, `2d`, `last 3 hours`). |
| `/help` | Show available commands and timeframe examples. |

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
| `REDIS_URL` | No | When set (e.g., `redis://default:password@host:6379/0`), enables Redis-backed message storage instead of the in-memory cache. |

## Development Notes

- By default the bot keeps transcripts in-memory. Provide `REDIS_URL` to persist messages in Redis (recommended for Render or any multi-instance deployment).
- `/summarize` currently analyzes up to 400 stored messages. Older content is truncated with a note.
- Need to verify changes? Use `bun test`, `bun run lint`, or `bun run typecheck`.

## Deployment Tips

- Run on an always-on host so the in-memory cache stays warm between summaries.
- Secure the webhook endpoint behind HTTPS and ensure Towns can reach the exposed URL.
- Monitor OpenAI usage to stay within rate limits and quotas.

## TODO:
- Update timeframe if there are too many messages and inform user about it
- Improve session management
- Improve hard messages limits
- Work on AI max character limits
- Improve prompt; it gets too long if there are too many messages - make it more concise
- Send key solicitation request if there is no active session for a specific stream
- Monetize the bot - tip the bot to get a summary
