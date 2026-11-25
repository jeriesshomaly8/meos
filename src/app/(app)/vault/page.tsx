import type { Metadata } from "next";
import { Lock } from "lucide-react";
import { Screen, ScreenHeader } from "@/components/kit/screen";
import { CategoryRail } from "@/components/kit/category-rail";
import { Empty } from "@/components/kit/empty";

export const metadata: Metadata = { title: "Secure Vault" };

/**
 * Deliberately not implemented in the MVP. Passwords and secrets require
 * dedicated end-to-end encryption (client-side keys, zero-knowledge storage)
 * and must never be handled like ordinary AI memory: no AI extraction, no
 * plain-text database rows, no inclusion in prompts. Shipping a naive version
 * would be worse than shipping none.
 */
export default function VaultPage() {
  return (
    <Screen>
      <ScreenHeader title="Secure Vault" />
      <CategoryRail />
      <Empty
        icon={Lock}
        title="Not built yet — on purpose"
        description="Passwords need end-to-end encryption, not ordinary AI memory. Until that ships, keep them in a dedicated password manager. MeOS will refuse to save them."
      />
    </Screen>
  );
}
