import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Sign in · DC Workbench",
  description: "Sign in to ClarionChain DC Workbench",
}

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children
}
