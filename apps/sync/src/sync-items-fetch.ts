type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export async function fetchJsonWithRetry<T>(input: {
  url: string;
  init?: RequestInit;
  attempts: number;
  timeoutMs: number;
  fetchImpl?: FetchLike;
}): Promise<T> {
  const fetchImpl = input.fetchImpl ?? fetch;
  let lastError: unknown;

  for (let attempt = 1; attempt <= input.attempts; attempt++) {
    try {
      const response = await fetchImpl(input.url, {
        ...input.init,
        signal: AbortSignal.timeout(input.timeoutMs),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return (await response.json()) as T;
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError instanceof Error) throw lastError;
  throw new Error(String(lastError));
}
