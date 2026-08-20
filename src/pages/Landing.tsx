import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Zap,
  Shield,
  Target,
  Brain,
  LineChart,
  AlertTriangle,
  ChevronRight,
  Terminal,
} from "lucide-react";
import { useNavigate } from "react-router";

const FEATURES = [
  {
    icon: Brain,
    title: "Multi-Factor Scoring",
    description:
      "Four weighted factors — technical structure, indicator confirmation, fundamentals, and sentiment — each scored transparently from -2 to +2.",
    color: "text-primary",
    bg: "bg-primary/10",
  },
  {
    icon: LineChart,
    title: "Directional Bias",
    description:
      "A clear bullish, bearish, or neutral bias with a confidence percentage. No hidden logic — every output traces back to its inputs.",
    color: "text-blue-400",
    bg: "bg-blue-400/10",
  },
  {
    icon: Target,
    title: "Key Levels & Risk",
    description:
      "Support, resistance, and invalidation levels derived from your inputs, plus R:R guidance and position sizing recommendations.",
    color: "text-emerald-400",
    bg: "bg-emerald-400/10",
  },
  {
    icon: Shield,
    title: "Transparent, Not Magic",
    description:
      "Explicit confidence scores, data-gap warnings, and invalidation scenarios. You stay in control — nothing is executed automatically.",
    color: "text-amber-400",
    bg: "bg-amber-400/10",
  },
];

const INSTRUMENTS = ["EUR/USD", "GBP/USD", "USD/JPY", "BTC/USD", "ETH/USD", "XAU/USD"];

const fadeUp = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.5 },
};

export default function Landing() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Navigation */}
      <header className="sticky top-0 z-50 border-b border-border/40 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary/15">
              <Terminal className="size-4 text-primary" />
            </div>
            <span className="text-sm font-bold tracking-tight font-mono">
              gilfan<span className="text-primary">/</span>trading-agent
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => navigate("/auth")} className="text-sm">
              Sign in
            </Button>
            <Button size="sm" onClick={() => navigate("/auth")} className="gap-1.5 text-sm">
              Launch
              <ChevronRight className="size-3.5" />
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
            <Badge variant="outline" className="text-[11px] font-mono mb-6 gap-1.5 border-primary/30 text-primary">
              <Zap className="size-3" />
              v1 · single instrument analysis
            </Badge>

            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.1] font-mono">
              <span className="text-primary">gilfan</span>
              <span className="text-muted-foreground">/</span>
              <br className="sm:hidden" />
              trading-agent
            </h1>

            <p className="mt-6 text-sm sm:text-base text-muted-foreground leading-relaxed max-w-xl mx-auto font-mono">
              Transparent directional bias for forex and crypto.
              <br className="hidden sm:block" />
              Technical + fundamental scoring — no black boxes.
            </p>

            <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
              <Button
                size="lg"
                onClick={() => navigate("/auth")}
                className="gap-2 px-7 text-sm font-semibold font-mono"
              >
                Open Terminal
                <ChevronRight className="size-4" />
              </Button>
              <Button
                variant="outline"
                size="lg"
                onClick={() => navigate("/auth")}
                className="gap-2 px-7 text-sm font-mono"
              >
                Guest Mode
              </Button>
            </div>

            {/* Supported instruments */}
            <div className="mt-10 flex items-center justify-center gap-2 flex-wrap">
              <span className="text-[11px] text-muted-foreground font-mono">$ instruments:</span>
              {INSTRUMENTS.map((s) => (
                <Badge key={s} variant="secondary" className="text-[11px] font-mono border-border/50">
                  {s}
                </Badge>
              ))}
              <Badge variant="secondary" className="text-[11px] font-mono border-border/50">
                + any pair
              </Badge>
            </div>
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
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight font-mono">What It Does</h2>
            <p className="mt-2 text-sm text-muted-foreground max-w-lg mx-auto font-mono">
              You submit an instrument. It returns a structured, auditable bias — with every
              scoring step visible.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {FEATURES.map((f, i) => (
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
                    <h3 className="text-sm font-semibold font-mono">{f.title}</h3>
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
                <span className="font-mono">$</span> scoring methodology
              </Badge>
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight font-mono">
                Weighted Bias
                <br />
                Breakdown
              </h2>
              <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
                Each analysis scores four factors from -2 (very bearish) to +2 (very bullish).
                The weighted average produces the final directional bias. Every number is visible — nothing
                is hidden behind a single "confidence" number.
              </p>

              <div className="mt-6 space-y-3">
                {[
                  { label: "Structure & Trend", weight: "30%", color: "bg-primary" },
                  { label: "Indicator Confirmation", weight: "25%", color: "bg-blue-400" },
                  { label: "Fundamentals & Catalysts", weight: "25%", color: "bg-emerald-400" },
                  { label: "Sentiment & Positioning", weight: "20%", color: "bg-violet-400" },
                ].map((f) => (
                  <div key={f.label} className="flex items-center gap-3">
                    <div className={`h-1.5 rounded-full ${f.color}`} style={{ width: f.weight }} />
                    <span className="text-xs font-medium text-muted-foreground whitespace-nowrap font-mono">
                      {f.label}
                    </span>
                    <span className="text-[10px] font-mono text-muted-foreground/70 ml-auto">
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
                  label: "Technical Summary",
                  desc: "Market structure, BOS/CHoCH, key zones, indicator readings",
                  icon: "📊",
                },
                {
                  label: "Fundamental Summary",
                  desc: "Monetary policy, economic events, regulatory developments",
                  icon: "📰",
                },
                {
                  label: "Score Breakdown",
                  desc: "Four factor scores with weights — fully traceable",
                  icon: "⚖️",
                },
                {
                  label: "Key Levels",
                  desc: "Support, resistance, and invalidation prices",
                  icon: "🎯",
                },
                {
                  label: "Risk Note",
                  desc: "R:R guidance, position sizing, disclaimers",
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
                  <span className="text-lg mt-0.5">{item.icon}</span>
                  <div>
                    <p className="text-sm font-semibold font-mono">{item.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{item.desc}</p>
                  </div>
                </motion.div>
              ))}
            </motion.div>
          </div>
        </div>
      </section>

      {/* Disclaimer */}
      <section className="border-t border-border/40 bg-amber-500/5">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8">
          <div className="flex items-start gap-3 max-w-2xl mx-auto flex-col items-center text-center">
            <AlertTriangle className="size-5 text-amber-500" />
            <div>
              <p className="text-sm font-semibold text-amber-400 font-mono">
                Not Financial Advice
              </p>
              <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                This is a decision-support tool. It does not execute trades, guarantee profits,
                or provide licensed financial advice. Always verify independently and manage risk.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-border/40">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-16 sm:py-20 text-center">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight font-mono">
            One instrument. One bias. Full transparency.
          </h2>
          <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto font-mono">
            Submit a pair, optionally add market data, and get a structured directional bias
            with every scoring factor visible.
          </p>
          <div className="mt-6 flex items-center justify-center gap-3">
            <Button size="lg" onClick={() => navigate("/auth")} className="gap-2 px-7 text-sm font-semibold font-mono">
              Launch Agent
              <ChevronRight className="size-4" />
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
              gilfan<span className="text-primary">/</span>trading-agent
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground font-mono">
            Decision-support tool · Not financial advice
          </p>
        </div>
      </footer>
    </div>
  );
}
