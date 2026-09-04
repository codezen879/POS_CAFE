"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { CupSoda } from "lucide-react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/";

  const [mode, setMode] = useState<"pin" | "password">("pin");
  const [identifier, setIdentifier] = useState("");
  const [secret, setSecret] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await signIn("credentials", {
        redirect: false,
        email: identifier,
        ...(mode === "pin" ? { pin: secret } : { password: secret }),
      });
      if (res?.error) {
        toast.error("Invalid credentials");
      } else {
        toast.success("Welcome back!");
        router.push(callbackUrl);
        router.refresh();
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-sm">
      <Card>
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <CupSoda className="h-6 w-6" />
          </div>
          <CardTitle className="text-xl">POS Cafe</CardTitle>
          <CardDescription>Sign in to the point of sale</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-4 grid grid-cols-2 gap-2 rounded-lg bg-muted p-1 text-center text-sm font-medium">
            <button
              type="button"
              onClick={() => setMode("pin")}
              className={`rounded-md py-1.5 transition-colors ${mode === "pin" ? "bg-card shadow text-foreground" : "text-muted-foreground"}`}
            >
              PIN
            </button>
            <button
              type="button"
              onClick={() => setMode("password")}
              className={`rounded-md py-1.5 transition-colors ${mode === "password" ? "bg-card shadow text-foreground" : "text-muted-foreground"}`}
            >
              Password
            </button>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="identifier">Email or User ID</Label>
              <Input
                id="identifier"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="you@example.com"
                autoComplete="username"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="secret">{mode === "pin" ? "PIN" : "Password"}</Label>
              <Input
                id="secret"
                type={mode === "pin" ? "password" : "password"}
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder={mode === "pin" ? "4-6 digit PIN" : "••••••••"}
                autoComplete={mode === "pin" ? "off" : "current-password"}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
