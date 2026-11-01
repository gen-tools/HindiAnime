export function shareInFlightRequest<T>(
  requests: Map<string, Promise<T>>,
  key: string,
  createRequest: () => Promise<T>
): Promise<T> {
  const existing = requests.get(key);
  if (existing) return existing;

  const request = Promise.resolve().then(createRequest);
  requests.set(key, request);
  const cleanup = () => {
    if (requests.get(key) === request) requests.delete(key);
  };
  void request.then(cleanup, cleanup);
  return request;
}
