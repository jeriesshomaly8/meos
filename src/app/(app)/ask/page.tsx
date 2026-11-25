import type { Metadata } from "next";
import { Screen, ScreenHeader } from "@/components/kit/screen";
import { AskForm } from "./ask-form";

export const metadata: Metadata = { title: "Ask MeOS" };

export default function AskPage() {
  return (
    <Screen>
      <ScreenHeader
        title="Ask MeOS"
        description="Answers come only from what you've saved — it never guesses."
      />
      <AskForm />
    </Screen>
  );
}
