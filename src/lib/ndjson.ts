/** 逐行读取 NDJSON 流，每解析出一条就回调；用于 Agent 与问答的流式事件 */
export async function readNdjson<T>(
  response: Response,
  onEvent: (event: T) => void,
): Promise<void> {
  if (!response.body) {
    return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const flush = (line: string) => {
    if (line.trim()) {
      onEvent(JSON.parse(line) as T);
    }
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      flush(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
    }
  }
  flush(buffer);
}
