import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Zap,
  Shield,
  Target,
  Brain,
  AlertTriangle,
  ChevronRight,
  Terminal,
  Layers,
  Scale,
  Ban,
  Crosshair,
  Waves,
} from "lucide-react";
import { Link, useNavigate } from "react-router";
import { useI18n } from "@/lib/i18n";
import type { Translations } from "@/lib/i18n/types";

const buildFeatures = (t: Translations) => [
  {
    icon: Layers,
    title: t.landing.featureStructureTitle,
    description: t.landing.featureStructureBody,
    color: "text-primary",
    bg: "bg-primary/10",
  },
  {
    icon: Waves,
    title: t.landing.featureSupplyTitle,
    description: t.landing.featureSupplyBody,
    color: "text-blue-400",
    bg: "bg-blue-400/10",
  },
  {
    icon: Crosshair,
    title: t.landing.featureMtfTitle,
    description: t.landing.featureMtfBody,
    color: "text-emerald-400",
    bg: "bg-emerald-400/10",
  },
  {
    icon: Scale,
    title: t.landing.featureFlowTitle,
    description: t.landing.featureFlowBody,
    color: "text-violet-400",
    bg: "bg-violet-400/10",
  },
];

/**
 * Phase 190 — example symbols only, and labelled as such in the UI.
 *
 * These are provider-native identifiers used as illustrations. `US30` was
 * removed because the instrument-type selector does not offer `indices`, so
 * advertising an index example would promise a path a user cannot take.
 */
const INSTRUMENT_EXAMPLES = ["EUR/USD", "BTC/USD", "XAU/USD", "NVDA", "WTI"];

const fadeUp = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.5 },
};

export default function Landing() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const features = buildFeatures(t);
  const assetClasses = [
    t.landing.assetCrypto,
    t.landing.assetForex,
    t.landing.assetStock,
    t.landing.assetCommodity,
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Navigation */}
      <header className="sticky top-0 z-50 border-b border-border/40 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-2 px-4 sm:px-6">
          {/* Phase 190 — the brand block shrinks before the auth controls do.
              "Sign in" doubles in length in Spanish ("Iniciar sesión"), so at
              320px the two must be allowed to compete for space rather than
              pushing the row into horizontal overflow. */}
          <Link
            to="/"
            aria-label={t.landing.homeAriaLabel}
            className="flex min-w-0 items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/15">
              <Terminal className="size-4 text-primary" aria-hidden="true" />
            </div>
            <span className="truncate text-sm font-bold tracking-tight font-mono">
              <span className="text-primary">Xstarz Analysis</span>
            </span>
          </Link>
          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            <Button variant="ghost" size="sm" onClick={() => navigate("/auth")} className="text-sm">
              {t.landing.signIn}
            </Button>
            <Button size="sm" onClick={() => navigate("/auth")} className="gap-1.5 text-sm">
              {t.landing.launch}
              <ChevronRight className="size-3.5 shrink-0" />
            </Button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative overflow-hidden">
        {/* Grid background — terminal feel */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:48px_48px]" />
        {/* Radial fade from center */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,var(--background)_70%)]" />

        <div className="relative mx-auto max-w-6xl px-4 sm:px-6 pt-24 sm:pt-32 pb-20 sm:pb-28">
          <motion.div {...fadeUp} className="text-center max-w-3xl mx-auto">
            <Badge
              variant="outline"
              className="text-[11px] font-mono mb-6 gap-1.5 border-primary/30 text-primary max-w-full whitespace-normal text-center h-auto py-1"
            >
              <Zap className="size-3 shrink-0" />
              {t.landing.heroBadge}
            </Badge>

            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.1] font-mono">
              <span className="text-primary">Xstarz Analysis</span>
              <br />
              <span className="text-lg sm:text-xl lg:text-2xl font-semibold text-muted-foreground break-words">
                {t.landing.heroRole}
              </span>
            </h1>

            <p className="mt-6 text-sm sm:text-base text-muted-foreground leading-relaxed max-w-xl mx-auto font-mono">
              {t.landing.heroBody}
            </p>

            <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
              <Button
                size="lg"
                onClick={() => navigate("/auth")}
                className="gap-2 px-7 text-sm font-semibold font-mono"
              >
                {t.landing.openTerminal}
                <ChevronRight className="size-4 shrink-0" />
              </Button>
              <Button
                variant="outline"
                size="lg"
                onClick={() => navigate("/auth")}
                className="gap-2 px-7 text-sm font-mono"
              >
                {t.landing.guestMode}
              </Button>
            </div>

            {/* Supported asset classes */}
            <div className="mt-10 flex items-center justify-center gap-2 flex-wrap">
              <span className="text-[11px] text-muted-foreground font-mono">
                {t.landing.coverageLabel}
              </span>
              {assetClasses.map((assetClass) => (
                <Badge
                  key={assetClass}
                  variant="secondary"
                  className="text-[11px] font-mono border-border/50 max-w-full whitespace-normal h-auto"
                >
                  {assetClass}
                </Badge>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-center gap-2 flex-wrap">
              <span className="text-[11px] text-muted-foreground font-mono">
                {t.landing.instrumentsLabel}
              </span>
              {INSTRUMENT_EXAMPLES.map((symbol) => (
                <Badge
                  key={symbol}
                  variant="outline"
                  className="text-[11px] font-mono border-primary/25 text-primary/90"
                >
                  {symbol}
                </Badge>
              ))}
            </div>
            {/* Phase 190 — replaces the old "+ any symbol" badge. Coverage is
                conditional on provider response, so the copy says exactly
                that instead of promising universal symbol support. */}
            <p className="mt-3 text-[11px] text-muted-foreground/80 max-w-md mx-auto leading-relaxed">
              {t.landing.coverageNote}
            </p>
          </motion.div>
        </div>
      </section>

      {/* Features Section */}
      <section className="border-t border-border/40">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-16 sm:py-20">
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-12"
          >
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight font-mono break-words">
              {t.landing.frameworkTitle}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground max-w-lg mx-auto font-mono">
              {t.landing.frameworkBody}
            </p>
          </motion.div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {features.map((f, i) => (
              <motion.div
                key={f.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
              >
                <Card className="h-full border-border/50 bg-card hover:bg-card/80 transition-colors">
                  <CardContent className="p-5">
                    <div className={`flex size-9 items-center justify-center rounded-lg ${f.bg} mb-3`}>
                      <f.icon className={`size-4.5 ${f.color}`} />
                    </div>
                    <h3 className="text-sm font-semibold font-mono break-words">{f.title}</h3>
                    <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">
                      {f.description}
                    </p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Methodology Section */}
      <section className="border-t border-border/40 bg-muted/10">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-16 sm:py-20">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
            >
              <Badge variant="outline" className="text-[11px] font-mono mb-4 gap-1.5 border-primary/30 text-primary">
                <Brain className="size-3 shrink-0" /> {t.landing.convictionBadge}
              </Badge>
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight font-mono break-words">
                {t.landing.convictionTitle}
                <br />
                {t.landing.convictionTitleEmphasis}
              </h2>
              <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
                {t.landing.convictionBody}
              </p>

              <div className="mt-6 space-y-3">
                {[
                  { label: t.landing.weightStructure, weight: "35%", color: "bg-primary" },
                  { label: t.landing.weightLiquidity, weight: "30%", color: "bg-blue-400" },
                  { label: t.landing.weightFundamental, weight: "20%", color: "bg-emerald-400" },
                  { label: t.landing.weightSentiment, weight: "15%", color: "bg-violet-400" },
                ].map((f) => (
                  <div key={f.label} className="flex items-center gap-3">
                    <div
                      className={`h-1.5 rounded-full shrink-0 ${f.color}`}
                      style={{ width: f.weight }}
                    />
                    {/* Phase 190 — `whitespace-nowrap` removed: translated
                        labels are longer than the English originals and would
                        otherwise push the row into horizontal overflow. */}
                    <span className="text-xs font-medium text-muted-foreground font-mono min-w-0 break-words">
                      {f.label}
                    </span>
                    <span className="text-[10px] font-mono text-muted-foreground/70 ml-auto shrink-0">
                      {f.weight}
                    </span>
                  </div>
                ))}
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              className="space-y-3"
            >
              {[
                {
                  label: t.landing.outputTechnicalLabel,
                  desc: t.landing.outputTechnicalDesc,
                  icon: "📊",
                },
                {
                  label: t.landing.outputFundamentalLabel,
                  desc: t.landing.outputFundamentalDesc,
                  icon: "📰",
                },
                {
                  label: t.landing.outputPlanLabel,
                  desc: t.landing.outputPlanDesc,
                  icon: "🎯",
                },
                {
                  label: t.landing.outputConvictionLabel,
                  desc: t.landing.outputConvictionDesc,
                  icon: "⚖️",
                },
                {
                  label: t.landing.outputInvalidationLabel,
                  desc: t.landing.outputInvalidationDesc,
                  icon: "⚠️",
                },
              ].map((item, i) => (
                <motion.div
                  key={item.label}
                  initial={{ opacity: 0, y: 10 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.08 }}
                  className="flex items-start gap-3 rounded-lg border border-border/50 bg-card/40 p-4"
                >
                  <span className="text-lg mt-0.5 shrink-0" aria-hidden="true">
                    {item.icon}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold font-mono break-words">{item.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{item.desc}</p>
                  </div>
                </motion.div>
              ))}
            </motion.div>
          </div>
        </div>
      </section>

      {/* Non-negotiables */}
      <section className="border-t border-border/40">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-14">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              {
                icon: Ban,
                title: t.landing.principleNoFabricationTitle,
                desc: t.landing.principleNoFabricationBody,
              },
              {
                icon: Shield,
                title: t.landing.principleCapitalTitle,
                desc: t.landing.principleCapitalBody,
              },
              {
                icon: Target,
                title: t.landing.principleNoAutoTitle,
                desc: t.landing.principleNoAutoBody,
              },
            ].map((item) => (
              <div key={item.title} className="rounded-lg border border-border/50 bg-card/40 p-5">
                <item.icon className="size-5 text-primary mb-3" aria-hidden="true" />
                <h3 className="text-sm font-semibold font-mono break-words">{item.title}</h3>
                <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Disclaimer */}
      <section className="border-t border-border/40 bg-amber-500/5">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8">
          <div className="flex items-start gap-3 max-w-2xl mx-auto flex-col items-center text-center">
            <AlertTriangle className="size-5 text-amber-500 shrink-0" aria-hidden="true" />
            <div>
              <p className="text-sm font-semibold text-amber-400 font-mono">
                {t.landing.disclaimerTitle}
              </p>
              <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                {t.landing.disclaimerBody}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-border/40">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-16 sm:py-20 text-center">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight font-mono break-words">
            {t.landing.ctaTitle}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto font-mono">
            {t.landing.ctaBody}
          </p>
          <div className="mt-6 flex items-center justify-center gap-3">
            <Button size="lg" onClick={() => navigate("/auth")} className="gap-2 px-7 text-sm font-semibold font-mono">
              {t.landing.ctaButton}
              <ChevronRight className="size-4 shrink-0" />
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/40 py-6">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="flex size-6 items-center justify-center rounded-md bg-primary/15">
              <Terminal className="size-3 text-primary" />
            </div>
            <span className="text-xs font-semibold font-mono">
              <span className="text-primary">Xstarz Analysis</span>
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground font-mono text-center sm:text-right">
            {t.landing.footerTagline}
          </p>
        </div>
      </footer>
    </div>
  );
}
