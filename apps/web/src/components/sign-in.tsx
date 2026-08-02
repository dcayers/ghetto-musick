import { useState, type FormEvent } from "react";
import { Button, Input, Label, TextField } from "react-aria-components";
import { signIn, signUp } from "../lib/api.js";

/**
 * Sign-in gate.
 *
 * Email and password because that is what the API actually supports today —
 * ADR-0004 targets passkey-first, but passkeys need a browser to enrol
 * against and this is that browser arriving. Now that `apps/web` exists, the
 * passkey plugin is unblocked; this form is the fallback it demotes to.
 */
export function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "sign-up") {
        await signUp({ email, password, name: name.trim() || email.split("@")[0]! });
      } else {
        await signIn({ email, password });
      }
      onSignedIn();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  const field =
    "border-border bg-surface-raised text-ink placeholder:text-ink-subtle focus:border-accent w-full rounded-md border px-3 py-2 text-sm outline-none";

  return (
    <div className="flex h-full items-center justify-center p-6">
      <form
        onSubmit={submit}
        className="border-border bg-surface w-full max-w-sm rounded-xl border p-6"
      >
        <h1 className="text-ink text-lg font-semibold">FlowGraph</h1>
        <p className="text-ink-muted mt-1 mb-5 text-sm">
          {mode === "sign-in"
            ? "Sign in to your library."
            : "Create an account — a personal workspace is set up for you."}
        </p>

        <div className="flex flex-col gap-3">
          {mode === "sign-up" && (
            <TextField value={name} onChange={setName} className="flex flex-col gap-1">
              <Label className="text-ink-muted text-xs">Name</Label>
              <Input className={field} autoComplete="name" />
            </TextField>
          )}

          <TextField
            value={email}
            onChange={setEmail}
            type="email"
            isRequired
            className="flex flex-col gap-1"
          >
            <Label className="text-ink-muted text-xs">Email</Label>
            <Input className={field} autoComplete="email" />
          </TextField>

          <TextField
            value={password}
            onChange={setPassword}
            type="password"
            isRequired
            className="flex flex-col gap-1"
          >
            <Label className="text-ink-muted text-xs">Password</Label>
            <Input
              className={field}
              autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
            />
            {mode === "sign-up" && (
              <span className="text-ink-subtle text-[11px]">At least 12 characters.</span>
            )}
          </TextField>
        </div>

        {error && (
          <p role="alert" className="text-danger mt-3 text-xs">
            {error}
          </p>
        )}

        <Button
          type="submit"
          isDisabled={busy}
          className="bg-accent hover:bg-accent-hover mt-5 w-full rounded-md px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {busy ? "Working…" : mode === "sign-in" ? "Sign in" : "Create account"}
        </Button>

        <Button
          onPress={() => {
            setMode(mode === "sign-in" ? "sign-up" : "sign-in");
            setError(null);
          }}
          className="text-ink-muted hover:text-ink mt-3 w-full text-center text-xs"
        >
          {mode === "sign-in"
            ? "No account? Create one"
            : "Already have an account? Sign in"}
        </Button>
      </form>
    </div>
  );
}
