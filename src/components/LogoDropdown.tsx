// simple logo dropdown component that can be used to go to the landing page or sign out for the user

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import logo from "@/assets/logo.svg";
import { useAuth } from "@/hooks/use-auth";
import { Home, LogOut } from "lucide-react";
import { useNavigate } from "react-router";
import { reportAuthDiagnostic } from "@/lib/auth/safe-diagnostics";

export function LogoDropdown() {
  const { isAuthenticated, signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    try {
      await signOut();
      navigate("/");
    } catch {
      // Phase 218 — never pass the rejection to the console. A failed
      // sign-out can echo session or token material, and the browser console
      // is user-visible and captured by extensions. Category only.
      reportAuthDiagnostic("sign-out-failed");
      // Leave the authenticated area regardless. Staying put after a failed
      // sign-out presents the user as still signed in on a session they asked
      // to end, which is the more dangerous outcome than an extra redirect.
      navigate("/");
    }
  };

  const handleGoHome = () => {
    navigate("/");
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-10 w-10">
          <img
            src={logo}
            alt="Logo"
            width={32}
            height={32}
            className="rounded-lg"
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuItem onClick={handleGoHome} className="cursor-pointer">
          <Home className="mr-2 h-4 w-4" />
          Landing Page
        </DropdownMenuItem>
        {isAuthenticated && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleSignOut}
              className="cursor-pointer text-destructive focus:text-destructive"
            >
              <LogOut className="mr-2 h-4 w-4" />
              Sign Out
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
