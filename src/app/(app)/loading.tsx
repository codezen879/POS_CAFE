"use client";

import dynamic from "next/dynamic";

const Zen3D = dynamic(() => import("@/components/three/zen-scene"), { ssr: false });

export default function AppLoading() {
  return (
    <div className="flex min-h-[55vh] items-center justify-center">
      <div className="flex flex-col items-center gap-5">
        <div className="relative flex h-36 w-36 items-center justify-center">
          <Zen3D variant="particles" className="absolute inset-0" />
          <Zen3D variant="beans" className="relative h-24 w-24" />
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
          Loading your workspace…
        </div>
      </div>
    </div>
  );
}