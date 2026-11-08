export function chromeBridge(type: "ping" | "openRequest", requestId?: string) {
  return new Promise<{ ok: boolean; reused?: boolean; error?: string }>(
    (resolve) => {
      const id = crypto.randomUUID();
      const timer = window.setTimeout(
        () => finish({ ok: false }),
        type === "ping" ? 3000 : 15000,
      );
      function finish(value: {
        ok: boolean;
        reused?: boolean;
        error?: string;
      }) {
        window.clearTimeout(timer);
        window.removeEventListener("message", receive);
        resolve(value);
      }
      function receive(event: MessageEvent) {
        if (
          event.source !== window ||
          event.origin !== location.origin ||
          event.data?.channel !== "jobtracker-extension-response" ||
          event.data.id !== id
        )
          return;
        const result = event.data.result;
        if (typeof result?.ok !== "boolean") return;
        finish(result);
      }
      window.addEventListener("message", receive);
      window.postMessage(
        { channel: "jobtracker-app-request", id, type, requestId },
        location.origin,
      );
    },
  );
}
