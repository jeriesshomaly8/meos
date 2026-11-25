"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { updateProfile } from "@/app/(app)/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const profileSchema = z.object({
  displayName: z.string().trim().min(1, "Display name can't be empty").max(80),
  timezone: z.string().min(1),
});

type ProfileValues = z.infer<typeof profileSchema>;

interface ProfileFormProps {
  initialDisplayName: string;
  initialTimezone: string;
  email: string;
}

export function ProfileForm({ initialDisplayName, initialTimezone, email }: ProfileFormProps) {
  const router = useRouter();
  const timezones = useMemo<string[]>(() => {
    const supported = Intl.supportedValuesOf("timeZone");
    return supported.includes(initialTimezone) ? supported : [initialTimezone, ...supported];
  }, [initialTimezone]);

  const form = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: { displayName: initialDisplayName, timezone: initialTimezone },
  });

  async function onSubmit(values: ProfileValues) {
    const result = await updateProfile(values);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    toast.success("Profile saved.");
    router.refresh();
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-2">
        <Label htmlFor="profile-email">Email</Label>
        <Input id="profile-email" value={email} disabled aria-describedby="profile-email-note" />
        <p id="profile-email-note" className="text-xs text-muted-foreground">
          Your sign-in email can&apos;t be changed here.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="profile-display-name">Display name</Label>
        <Input id="profile-display-name" {...form.register("displayName")} />
        {form.formState.errors.displayName && (
          <p className="text-sm text-destructive">{form.formState.errors.displayName.message}</p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="profile-timezone">Timezone</Label>
        <Controller
          control={form.control}
          name="timezone"
          render={({ field }) => (
            <Select
              value={field.value}
              onValueChange={(value) => {
                if (value) field.onChange(value);
              }}
            >
              <SelectTrigger id="profile-timezone" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {timezones.map((timezone) => (
                  <SelectItem key={timezone} value={timezone}>
                    {timezone}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
        <p className="text-xs text-muted-foreground">
          Used to understand dates like &ldquo;next Friday&rdquo; correctly.
        </p>
      </div>

      <Button type="submit" className="h-12 w-full sm:w-auto sm:self-start" disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting && <Loader2 className="size-4 animate-spin" aria-hidden />}
        Save profile
      </Button>
    </form>
  );
}
