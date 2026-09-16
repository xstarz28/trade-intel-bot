/**
 * Phase 182 — /download.
 *
 * The future official-website download page. Xstarz Analysis ships on four
 * surfaces from one codebase: web, Android, iOS and Windows desktop.
 *
 * NO DOWNLOAD URL IS HARDCODED. The project has no official custom domain and
 * no published installer yet, so inventing a link would produce a button that
 * 404s for real users. Each channel renders as explicitly unavailable until
 * the release pipeline publishes a signed artifact and the domain exists —
 * see docs/DESKTOP-DISTRIBUTION.md.
 */

import { motion } from "framer-motion";
import { useNavigate } from "react-router";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

/**
 * Distribution channels.
 *
 * `href` is intentionally null everywhere. When a real signed installer and a
 * real Store listing exist, those values arrive from deployment configuration
 * — never from a guess committed to source.
 */
const CHANNELS = [
  { id: "windows", titleKey: "legal.downloadWindows", detailKey: "legal.downloadWindowsDetail", href: null },
  { id: "store", titleKey: "legal.downloadStore", detailKey: "legal.downloadStoreDetail", href: null },
] as const;

const OTHER_SURFACES = [
  { id: "web", labelKey: "legal.downloadWeb" },
  { id: "android", labelKey: "legal.downloadAndroid" },
  { id: "ios", labelKey: "legal.downloadIos" },
] as const;

export default function Download() {
  const { tx } = useI18n();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <h1 className="text-3xl font-semibold tracking-tight">
            {tx("legal.downloadTitle")}
          </h1>
          <p className="mt-3 text-muted-foreground leading-relaxed">
            {tx("legal.downloadIntro")}
          </p>

          <div className="mt-10 space-y-4">
            {CHANNELS.map((channel) => (
              <Card key={channel.id}>
                <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="font-medium">{tx(channel.titleKey)}</h2>
                      {channel.href === null && (
                        <Badge variant="secondary">
                          {tx("legal.downloadUnavailable")}
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {tx(channel.detailKey)}
                    </p>
                  </div>
                  {/*
                    Disabled rather than hidden: a user looking for the desktop
                    app should see that it is planned and not yet downloadable,
                    instead of finding nothing and assuming it does not exist.
                  */}
                  <Button disabled className="shrink-0">
                    {tx("legal.downloadUnavailable")}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="mt-10">
            <h2 className="text-sm font-medium text-muted-foreground">
              {tx("legal.downloadOtherSurfaces")}
            </h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {OTHER_SURFACES.map((surface) => (
                <Badge key={surface.id} variant="outline">
                  {tx(surface.labelKey)}
                </Badge>
              ))}
            </div>
          </div>

          <div className="mt-12">
            <Button variant="ghost" onClick={() => void navigate("/")}>
              {tx("legal.backHome")}
            </Button>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
