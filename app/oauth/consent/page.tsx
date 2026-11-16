
"use client";

import { useEffect, useState } from "react";
import { createClient } from "../../../lib/supabase/client";

type ConsentInfo = {
  appName: string;
  redirectUri: string;
  scopes: string[];
};

export default function ConsentPage() {
  const [authorizationId, setAuthorizationId] = useState("");
  const [info, setInfo] = useState<ConsentInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const id = new URLSearchParams(
      window.location.search
    ).get("authorization_id");

    if (!id) {
      setError("Tidak ada permintaan OAuth yang aktif.");
      setLoading(false);
      return;
    }

    setAuthorizationId(id);

    async function loadAuthorization() {
      try {
        const supabase = createClient();

        const { data: userData } =
          await supabase.auth.getUser();

        if (!userData.user) {
          window.location.replace(
            `/login?authorization_id=${encodeURIComponent(id!)}`
          );
          return;
        }

        const { data, error: authError } =
          await supabase.auth.oauth.getAuthorizationDetails(id!);

        if (authError) throw authError;
        if (!data) throw new Error("Permintaan OAuth tidak valid.");

        if (!("authorization_id" in data)) {
          window.location.replace(data.redirect_url);
          return;
        }

        setInfo({
          appName: data.client.name,
          redirectUri: data.redirect_uri,
          scopes: (data.scope || "").split(" ").filter(Boolean),
        });
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Gagal memuat izin."
        );
      } finally {
        setLoading(false);
      }
    }

    loadAuthorization();
  }, []);

  async function decide(approve: boolean) {
    if (!authorizationId || working) return;

    setWorking(true);
    setError("");

    try {
      const supabase = createClient();

      const { data, error: decisionError } = approve
        ? await supabase.auth.oauth.approveAuthorization(
            authorizationId
          )
        : await supabase.auth.oauth.denyAuthorization(
            authorizationId
          );

      if (decisionError) throw decisionError;
      if (!data) throw new Error("Gagal memproses keputusan.");

      window.location.assign(data.redirect_url);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Terjadi kesalahan."
      );
      setWorking(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 p-6 text-white">
      <section className="w-full max-w-md space-y-5 rounded-2xl border border-zinc-800 bg-zinc-900 p-8">
        <h1 className="text-2xl font-semibold">
          Charmaine Memory
        </h1>

        {loading && <p>Memeriksa permintaan akses...</p>}

        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}

        {info && (
          <>
            <p>
              <strong>{info.appName}</strong> meminta akses ke
              akun Charmaine Memory kamu.
            </p>

            <div className="space-y-2 text-sm text-zinc-300">
              <p>Alamat tujuan: {info.redirectUri}</p>
              <p>Izin yang diminta:</p>
              <ul className="list-inside list-disc">
                {info.scopes.map((scope) => (
                  <li key={scope}>{scope}</li>
                ))}
              </ul>
            </div>

            <button
              disabled={working}
              onClick={() => decide(true)}
              className="w-full rounded-lg bg-white p-3 font-medium text-black disabled:opacity-50"
            >
              Izinkan Akses
            </button>

            <button
              disabled={working}
              onClick={() => decide(false)}
              className="w-full rounded-lg border border-zinc-600 p-3 disabled:opacity-50"
            >
              Tolak
            </button>
          </>
        )}
      </section>
    </main>
  );
}
