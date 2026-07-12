from __future__ import annotations

import asyncio
from collections import deque
from contextlib import asynccontextmanager
from time import monotonic

from .models import RateLimit


class RateLimiter:
    def __init__(self, config: RateLimit, fallback_concurrency: int) -> None:
        self.config = config
        self._semaphore = asyncio.Semaphore(config.maxConcurrentRequests or fallback_concurrency)
        self._lock = asyncio.Lock()
        self._requests: deque[float] = deque()
        self._tokens: deque[tuple[float, int]] = deque()

    @asynccontextmanager
    async def limit(self, estimated_tokens: int):
        await self._semaphore.acquire()
        try:
            await self._wait_for_window(estimated_tokens)
            yield
        finally:
            self._semaphore.release()

    async def _wait_for_window(self, tokens: int) -> None:
        while True:
            async with self._lock:
                now = monotonic()
                cutoff = now - self.config.windowSeconds
                while self._requests and self._requests[0] <= cutoff:
                    self._requests.popleft()
                while self._tokens and self._tokens[0][0] <= cutoff:
                    self._tokens.popleft()
                request_ok = (
                    self.config.requestsPerWindow is None or len(self._requests) < self.config.requestsPerWindow
                )
                token_ok = (
                    self.config.estimatedTokensPerWindow is None
                    or sum(value for _, value in self._tokens) + tokens <= self.config.estimatedTokensPerWindow
                )
                if request_ok and token_ok:
                    self._requests.append(now)
                    self._tokens.append((now, tokens))
                    return
                oldest = min(
                    [self._requests[0] if self._requests else now, self._tokens[0][0] if self._tokens else now]
                )
                delay = max(0.001, oldest + self.config.windowSeconds - now)
            await asyncio.sleep(delay)
