import { z } from "npm:zod@4.3.6";

export const AzureGlobalArgsSchema = z.object({
  subscriptionId: z.string().describe(
    "Azure subscription ID. Use: ${{ vault.get('azure', 'SUBSCRIPTION_ID') }}",
  ),
  resourceGroup: z
    .string()
    .optional()
    .describe("Default resource group for operations that require one"),
});

/**
 * Global arguments for tenant-scoped Entra ID (`az ad`) models. Entra
 * directory objects are not subscription-scoped, so these models pass
 * `undefined` for the subscription to {@link az} and never emit a
 * `--subscription` flag. Authentication uses the active `az login`
 * session; `tenantId` is informational/documentary only — `az ad`
 * commands target whatever tenant that session is signed in to.
 */
export const EntraGlobalArgsSchema = z.object({
  tenantId: z
    .string()
    .optional()
    .describe(
      "Entra tenant ID for context/documentation. Auth uses the active az login session.",
    ),
});

export async function az(
  args: string[],
  subscriptionId?: string,
): Promise<unknown> {
  const fullArgs = [...args, "--output", "json"];
  if (subscriptionId) {
    fullArgs.push("--subscription", subscriptionId);
  }

  const cmd = new Deno.Command("az", {
    args: fullArgs,
    stdout: "piped",
    stderr: "piped",
  });

  const result = await cmd.output();
  const stderr = new TextDecoder().decode(result.stderr);

  if (result.code !== 0) {
    throw new Error(`az ${args.slice(0, 2).join(" ")} failed: ${stderr}`);
  }

  const stdout = new TextDecoder().decode(result.stdout).trim();
  if (!stdout) return null;

  return JSON.parse(stdout);
}

/**
 * Acquire a Microsoft Graph access token from the active `az login` session.
 * The token arrives in `az`'s JSON output (never on a command line) and lives
 * only in memory for the duration of the request — it is never logged or
 * persisted.
 */
export async function graphToken(): Promise<string> {
  const result = (await az(
    [
      "account",
      "get-access-token",
      "--resource",
      "https://graph.microsoft.com",
    ],
    undefined,
  )) as { accessToken?: string } | null;
  const token = result?.accessToken;
  if (!token) {
    throw new Error(
      "Could not acquire a Microsoft Graph access token from the active az session",
    );
  }
  return token;
}

/**
 * Make an authenticated Microsoft Graph v1.0 request. The bearer token and any
 * request body stay in memory and on the HTTPS wire — never in process
 * arguments, logs, or model data. Returns the HTTP status and parsed body so
 * the caller can branch on it.
 */
export async function graphRequest(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: unknown }> {
  const token = await graphToken();
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

/**
 * Acquire an Azure Resource Manager access token from the active `az login`
 * session. Same handling as {@link graphToken} — the token arrives in `az`'s
 * JSON output, lives only in memory, and is never logged or persisted.
 */
export async function armToken(): Promise<string> {
  const result = (await az(
    [
      "account",
      "get-access-token",
      "--resource",
      "https://management.azure.com",
    ],
    undefined,
  )) as { accessToken?: string } | null;
  const token = result?.accessToken;
  if (!token) {
    throw new Error(
      "Could not acquire an ARM access token from the active az session",
    );
  }
  return token;
}

/**
 * Make an authenticated Azure Resource Manager request against a full ARM
 * URL. Used for control-plane APIs the `az` CLI covers poorly or not at all —
 * Cost Management queries, Resource Graph, and Consumption reservation
 * recommendations — where the CLI either lacks the verb or requires an
 * optional CLI extension. Throws on non-2xx so callers get the ARM error text
 * rather than silently parsing an error envelope.
 */
export async function armRequest(
  method: string,
  url: string,
  body?: unknown,
): Promise<unknown> {
  const token = await armToken();
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`ARM ${method} ${res.status}: ${text.slice(0, 600)}`);
  }
  return text ? JSON.parse(text) : null;
}

/**
 * Classify an error thrown by {@link az} as a "not found" condition, so
 * delete-style methods can treat an already-absent target as success
 * (idempotent delete) rather than failing the workflow.
 */
export function isAzNotFound(err: unknown): boolean {
  const msg = String(err).toLowerCase();
  return (
    msg.includes("not found") ||
    msg.includes("does not exist") ||
    msg.includes("resourcenotfound") ||
    msg.includes("request_resourcenotfound") ||
    msg.includes("could not be found")
  );
}

/**
 * Classify an error thrown by {@link az} as an "already exists" / conflict
 * condition, so create-style methods can converge on the existing resource
 * instead of failing (idempotent create).
 */
export function isAzAlreadyExists(err: unknown): boolean {
  const msg = String(err).toLowerCase();
  return (
    msg.includes("already exist") ||
    msg.includes("roleassignmentexists") ||
    msg.includes("already present") ||
    msg.includes("references already exist") ||
    msg.includes("conflict")
  );
}

export function sanitizeInstanceName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\.\./g, "--")
    .replace(/[/\\]/g, "-")
    .replace(/\0/g, "");
}

export function requireResourceGroup(
  methodArg: string | undefined,
  globalArg: string | undefined,
): string {
  const rg = methodArg || globalArg;
  if (!rg) {
    throw new Error(
      "resourceGroup is required — pass it as an argument or set it in globalArguments",
    );
  }
  return rg;
}

/**
 * Poll a condition function until it returns true or the timeout expires.
 * Used for readiness polling after create/update operations where the CLI
 * returns before the resource reaches a stable state.
 *
 * @param check - async function that returns true when the resource is ready
 * @param options - intervalMs (default 5000), timeoutMs (default 300000), label for logging
 * @returns true if ready, false if timed out
 */
export async function pollUntilReady(
  check: () => Promise<boolean>,
  options?: { intervalMs?: number; timeoutMs?: number; label?: string },
): Promise<boolean> {
  const interval = options?.intervalMs ?? 5000;
  const timeout = options?.timeoutMs ?? 300000;
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, interval));
  }
  return false;
}
