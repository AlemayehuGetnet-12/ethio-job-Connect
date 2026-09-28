"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import axios from "axios";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { getApiUrl } from "../api-config";

const schema = z.object({
  password: z.string().min(6, "Password must be at least 6 characters"),
  confirmPassword: z.string().min(6, "Please confirm your password"),
}).refine((data) => data.password === data.confirmPassword, {
  path: ["confirmPassword"],
  message: "Passwords do not match",
});

export default function ResetPasswordForm() {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const searchParams = useSearchParams();
  const router = useRouter();
  const tokenFromQuery = searchParams.get("token");
n  // Allow rendering the form in development even if the token is missing.
  // Use a fake local token to simulate the flow without contacting the backend.
  const isDev = process.env.NODE_ENV === "development";
  const [simulateEnabled, setSimulateEnabled] = useState(isDev);
  const DEV_TOKEN = "__dev_local_token__";
  const token = tokenFromQuery ?? (isDev && simulateEnabled ? DEV_TOKEN : null);
const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({ resolver: zodResolver(schema) });
n  useEffect(() => {
    if (!tokenFromQuery && !isDev) {
      setError("Invalid or missing reset token.");
    } else {
      setError(null);
    }
  }, [tokenFromQuery, isDev]);
n  const onSubmit = async (data) => {
    setLoading(true);
    setError(null);
    setStatus(null);
n    // If running locally in dev and using the fake token, simulate success without calling the API.
    if (token === "__dev_local_token__") {
      // short simulated delay for UX
      setTimeout(() => {
        setStatus("(Local) Your password has been reset. You can now sign in.");
        setLoading(false);
        setTimeout(() => router.push("/login"), 1000);
      }, 600);
      return;
    }
n    if (!token) {
      setError("Invalid or missing reset token.");
      setLoading(false);
      return;
    }
n    try {
      await axios.post(getApiUrl(`/api/auth/reset-password?token=${encodeURIComponent(token)}`), {
        password: data.password,
      });
      setStatus("Your password has been reset. You can now sign in.");
      setTimeout(() => router.push("/login"), 2000);
    } catch (err) {
      setError("Unable to reset password. The link may be invalid or expired.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6 py-12">
        <div className="rounded-3xl border border-slate-800 bg-slate-900 p-10 shadow-xl shadow-slate-950/20">
          <h1 className="text-3xl font-semibold">Set a new password</h1>
          <p className="mt-3 text-slate-400">Provide a new password to regain access to your account.</p>

          {isDev && (
            <div className="mt-4 flex items-center justify-between gap-4 rounded-md bg-amber-900/10 border border-amber-700 p-3 text-sm text-amber-200">
              <div>Dev/Test mode: local simulation {simulateEnabled ? 'enabled' : 'disabled'}.</div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSimulateEnabled((s) => !s)}
                  className="rounded-full bg-amber-700 px-3 py-1 text-sm font-medium text-slate-900 hover:opacity-90"
                >
                  {simulateEnabled ? 'Disable' : 'Enable'}
                </button>
              </div>
            </div>
          )}
          <form onSubmit={handleSubmit(onSubmit)} className="mt-8 space-y-6">
            <label className="block">
              <span className="text-sm text-slate-400">New password</span>
              <input
                type="password"
                {...register("password")}
                className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100 outline-none transition focus:border-primary"
              />
              {errors.password && <span className="text-sm text-rose-400">{errors.password.message}</span>}
            </label>
            <label className="block">
              <span className="text-sm text-slate-400">Confirm password</span>
              <input
                type="password"
                {...register("confirmPassword")}
                className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100 outline-none transition focus:border-primary"
              />
              {errors.confirmPassword && <span className="text-sm text-rose-400">{errors.confirmPassword.message}</span>}
            </label>
            {error && <p className="text-sm text-rose-400">{error}</p>}
            {status && <p className="text-sm text-emerald-400">{status}</p>}
            <button
              type="submit"
              disabled={loading || !token}
              className="w-full rounded-full bg-primary px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Resetting..." : "Reset password"}
            </button>
          </form>
          <p className="mt-6 text-sm text-slate-400">
            Remembered your password? <Link href="/login" className="text-white underline">Sign in</Link>.
          </p>
        </div>
      </div>
    </div>
  );
}
