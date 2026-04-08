import { redirect } from "next/navigation"
import { getSessionUserId } from "@/lib/api-auth"
import { getUserById } from "@/lib/db"
import { OpenPreferencesRedirect } from "@/components/account/open-preferences-redirect"

export const metadata = {
  title: "Account · DC Workbench",
}

export default async function AccountPage() {
  const userId = await getSessionUserId()
  if (userId == null) {
    redirect("/login")
  }
  const user = getUserById(userId)
  if (!user) {
    redirect("/login")
  }

  return <OpenPreferencesRedirect tab="account" />
}
