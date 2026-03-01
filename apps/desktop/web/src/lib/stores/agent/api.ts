import { invoke } from "@tauri-apps/api/core";

interface RpcSuccess<TData> {
  success: true;
  data: TData;
}

interface RpcFailure {
  success: false;
  error: string;
}

type RpcResponse<TData> = RpcSuccess<TData> | RpcFailure;

function isRpcSuccess<TData>(value: unknown): value is RpcSuccess<TData> {
  return (
    value !== null &&
    typeof value === "object" &&
    "success" in value &&
    value.success === true
  );
}

function extractRpcError(value: unknown, fallback: string): string {
  if (value && typeof value === "object" && "error" in value) {
    const candidate = (value as { error?: unknown }).error;
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }

  return fallback;
}

export async function invokeAgentRpc<TData>(
  command: string,
  payload: Record<string, unknown>,
  fallbackError: string,
): Promise<TData> {
  const response = await invoke<RpcResponse<TData>>(command, payload);

  if (isRpcSuccess<TData>(response)) {
    return response.data;
  }

  throw new Error(extractRpcError(response, fallbackError));
}

// Commands that return Result<(), String> from Rust do not use the
// { success, data/error } RPC envelope. On success they resolve to null/undefined.
export async function invokeAgentCommand(
  command: string,
  payload: Record<string, unknown>,
  fallbackError: string,
): Promise<void> {
  const response = await invoke<unknown>(command, payload);

  if (
    response !== null &&
    typeof response === "object" &&
    "success" in response &&
    (response as { success?: unknown }).success === false
  ) {
    throw new Error(extractRpcError(response, fallbackError));
  }
}
