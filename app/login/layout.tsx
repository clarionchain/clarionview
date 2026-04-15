import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Sign in · ClarionView",
  description: "Sign in to ClarionView",
}

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children
}
