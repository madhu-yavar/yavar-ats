import { Link } from "@tanstack/react-router";

import logoAsset from "@/assets/yavar-logo.png.asset.json";

/** The Yavar wordmark, sized for a light surface. */
export function BrandLogo({ className = "h-7" }: { className?: string }) {
  return <img src={logoAsset.url} alt="Yavar" className={`${className} w-auto`} />;
}

const LINKEDIN = "https://www.linkedin.com/company/yavar-techworks/";

/** Legal footer shown across the application. */
export function BrandFooter() {
  return (
    <footer className="mt-8 border-t border-border px-4 py-5 text-xs text-muted-foreground sm:px-6">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-3">
        <span>© Copyright {new Date().getFullYear()} Yavar AI. All rights reserved.</span>
        <nav className="flex flex-wrap items-center gap-4">
          <Link to="/privacy" className="hover:text-foreground hover:underline">
            Privacy Policy
          </Link>
          <Link to="/cookies" className="hover:text-foreground hover:underline">
            Cookies Policy
          </Link>
          <a href="https://yavar.ai" target="_blank" rel="noreferrer" className="hover:text-foreground hover:underline">
            yavar.ai
          </a>
          <a href={LINKEDIN} target="_blank" rel="noreferrer" className="hover:text-foreground hover:underline">
            LinkedIn
          </a>
        </nav>
      </div>
    </footer>
  );
}
