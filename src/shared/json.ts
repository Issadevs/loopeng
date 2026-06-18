/**
 * Find the first balanced JSON object `{...}` in `text`, handling string
 * escapes correctly. Returns the raw slice, or throws if none is found.
 */
export function extractFirstJsonObject(response: string): string {
  const start = response.indexOf("{");

  if (start === -1) {
    throw new Error("response did not contain a JSON object");
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < response.length; index += 1) {
    const char = response[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;

      if (depth === 0) {
        return response.slice(start, index + 1);
      }
    }
  }

  throw new Error("response JSON object was not balanced");
}

/**
 * Parse the first balanced JSON object from `text`.
 * Returns `undefined` when no balanced object is found or parsing fails.
 */
export function parseFirstJson<T = unknown>(text: string): T | undefined {
  try {
    const slice = extractFirstJsonObject(text);
    return JSON.parse(slice) as T;
  } catch {
    return undefined;
  }
}
