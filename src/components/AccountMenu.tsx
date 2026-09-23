import { useQuery } from "@tanstack/react-query";
import { KeyRound, LogOut, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { changePasswordRequest, fetchMe, signOutApp } from "@/lib/auth-client";
import { useOrg } from "@/hooks/useOrg";
import { usePlatform } from "@/hooks/usePlatform";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const ROLE_LABEL: Record<string, string> = {
  recruiter: "Recruiter",
  hiring_manager: "Hiring manager",
  department_head: "Department head",
  hr_head: "HR head",
  president_cbo: "CHRO / President",
};

/**
 * Who is signed in and what they are allowed to do, with sign out in the same
 * place — the top bar beside the notification bell.
 */
export function AccountMenu() {
  const { org, roles, isOwner } = useOrg();
  const { isSuperUser } = usePlatform();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [changeOpen, setChangeOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changing, setChanging] = useState(false);

  const session = useQuery({
    queryKey: ["auth_identity"],
    queryFn: async () => {
      const email = await fetchMe();
      return email ? { email, fullName: email } : null;
    },
    staleTime: 300_000,
  });

  const email = session.data?.email ?? null;
  const name = session.data?.fullName ?? email ?? "You";
  const initials = String(name)
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");

  // Highest privilege first, so the top bar always states the real authority.
  const privileges = [
    ...(isSuperUser ? ["Platform super admin"] : []),
    ...(isOwner ? ["Organisation owner"] : []),
    ...roles.map((r) => ROLE_LABEL[r] ?? r),
  ];
  const headline = privileges[0] ?? "Member";

  useEffect(() => {
    if (!open) setSigningOut(false);
  }, [open]);

  useEffect(() => {
    if (!changeOpen) {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setChanging(false);
    }
  }, [changeOpen]);

  async function changePassword() {
    if (newPassword.length < 8) {
      toast.error("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("The two new passwords do not match.");
      return;
    }
    setChanging(true);
    try {
      toast.success(await changePasswordRequest(currentPassword, newPassword));
      setChangeOpen(false);
      setOpen(false);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setChanging(false);
    }
  }

  async function signOut() {
    setSigningOut(true);
    await signOutApp();
    // The session is the httpOnly cookie — reload so the auth gate re-bootstraps.
    window.location.assign("/");
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          className="h-9 gap-2 px-2"
          aria-label="Account, privileges and sign out"
        >
          <span className="flex size-6 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
            {initials || <UserRound className="size-3.5" />}
          </span>
          <span className="hidden text-left leading-tight sm:block">
            <span className="block max-w-[140px] truncate text-xs font-semibold">{name}</span>
            <span className="block max-w-[140px] truncate text-[10px] text-muted-foreground">
              {headline}
            </span>
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[280px] p-0">
        <div className="border-b border-border p-3">
          <p className="truncate text-sm font-semibold">{name}</p>
          {email ? <p className="truncate text-xs text-muted-foreground">{email}</p> : null}
          {org ? (
            <p className="mt-1 truncate text-xs text-muted-foreground">{org.name}</p>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">No organisation yet</p>
          )}
        </div>
        <div className="border-b border-border p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Access level
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {privileges.length ? (
              privileges.map((p) => (
                <Badge key={p} variant={p === headline ? "default" : "secondary"}>
                  {p}
                </Badge>
              ))
            ) : (
              <span className="text-xs text-muted-foreground">
                No roles granted yet — ask your owner for access.
              </span>
            )}
          </div>
          {isSuperUser ? (
            <p className="mt-2 text-[11px] text-muted-foreground">
              You can see every organisation on the platform console.
            </p>
          ) : (
            <p className="mt-2 text-[11px] text-muted-foreground">
              You only see data for this organisation.
            </p>
          )}
        </div>
        <div className="p-2">
          <Button
            variant="ghost"
            className="w-full justify-start"
            onClick={() => {
              setOpen(false);
              setChangeOpen(true);
            }}
          >
            <KeyRound className="size-4" /> Change password
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-start"
            onClick={signOut}
            disabled={signingOut}
          >
            <LogOut className="size-4" /> {signingOut ? "Signing out…" : "Sign out"}
          </Button>
        </div>
      </PopoverContent>
      <Dialog open={changeOpen} onOpenChange={setChangeOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Change password</DialogTitle>
            <DialogDescription>
              Updating your password signs out every other device. This device stays signed in.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void changePassword();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="current-password">Current password</Label>
              <Input
                id="current-password"
                type="password"
                required
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-account-password">New password</Label>
              <Input
                id="new-account-password"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-account-password">Repeat new password</Label>
              <Input
                id="confirm-account-password"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
            <Button type="submit" className="w-full" disabled={changing}>
              {changing ? "Updating…" : "Update password"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </Popover>
  );
}
