import { redirect } from "next/navigation"
import { getSessionUserId } from "@/lib/api-auth"
import { isUserAdmin } from "@/lib/db"
import { AdminUsersClient } from "@/components/admin/admin-users-client"

export const metadata = {
  title: "Users · DC Workbench",
}

export default async function AdminUsersPage() {
  const userId = await getSessionUserId()
  if (userId == null) {
    redirect("/login")
  }
  if (!isUserAdmin(userId)) {
    redirect("/")
  }
  return (
    <div className="p-4 lg:p-6">
      <AdminUsersClient />
    </div>
  )
}
