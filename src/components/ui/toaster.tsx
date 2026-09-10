"use client";

import { Toaster as HotToaster } from "react-hot-toast";

export function Toaster() {
  return (
    <HotToaster
      position="top-center"
      toastOptions={{
        className: "!bg-card !text-card-foreground !border !border-border !shadow-lg",
        duration: 3000,
      }}
    />
  );
}
