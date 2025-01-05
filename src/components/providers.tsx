"use client";

import { ReactNode } from "react";
import { NextUIProvider as ThemeProvider } from "@nextui-org/react";
import { ReactFlowProvider } from "@xyflow/react";

export const RootProviders = ({ children }: { children: ReactNode }) => {
  return <ThemeProvider>{children}</ThemeProvider>;
};

export const ProtectedProviders = ({ children }: { children: ReactNode }) => {
  return <ReactFlowProvider>{children}</ReactFlowProvider>;
};
