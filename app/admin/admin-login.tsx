"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./admin.module.css";

export function AdminLogin() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit() {
    setPending(true);
    setError(null);
    const response = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    }).catch(() => null);
    setPending(false);
    if (response?.ok) return router.refresh();
    setError((await response?.json().catch(() => null))?.error ?? "Could not reach the server.");
  }

  return (
    <main className={styles.main}>
      <h1 className={styles.title}>Admin</h1>
      <form
        className={styles.row}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <input
          className={styles.input}
          type="password"
          autoComplete="current-password"
          aria-label="Admin password"
          placeholder="Password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <button className={styles.button} type="submit" disabled={pending || !password}>
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>
      {error && <p className={styles.error}>{error}</p>}
    </main>
  );
}
