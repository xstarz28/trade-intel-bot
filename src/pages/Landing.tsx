import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  TrendingUp,
  BarChart3,
  Shield,
  Zap,
  Target,
  Brain,
  LineChart,
  AlertTriangle,
  ChevronRight,
} from "lucide-react";
import { useNavigate } from "react-router";

const FEATURES = [
  {
    icon: Brain,
    title: "Multi-Factor Analysis",
    description:
      "Weighted scoring across technicals, fundamentals, sentiment, and positioning — transparent, not a black box.",
    color: "text-primary",
    bg: "bg-primary/10",
  },
  {
    icon: LineChart,
    title: "Structured Bias Output",
    description:
      "Clear bullish/bearish/neutral bias with confidence percentage and full score breakdown for every analysis.",
    color: "text-blue-500",
    bg: "bg-blue-500/10",
  },
  {
    icon: Target,
    title: "Key Levels & Risk",
    description:
      "Auto-derived support, resistance, and invalidation levels with R:R guidance and position sizing suggestions.",
    color: "text-emerald-500",
    bg: "bg-emerald-500/10",
  },
  {
    icon: Shield,
    title: "Decision-Support, Not Advice",
    description:
      "Explicit confidence levels, data-gap warnings, and invalidation scenarios. Always verify independently.",
    color: "text-amber-500",
    bg: "bg-amber-500/10",
  },
];

const INSTRUMENTS = ["EUR/USD", "GBP/USD", "BTC/USD", "ETH/USD", "XAU/USD", "SOL/USD"];

const fadeUp = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.5 },
};

export default function Landing() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      {/* Navigation */}
      <header className="sticky top-0 z-50 border-b border-border/40 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10">
              <Zap className="size-4 text-primary" />
            </div>
            <span className="text-sm font-bold tracking-tight">
              Trade<span className="text-primary">Edge</span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => navigate("/auth")} className="text-sm">
              Sign in
            </Button>
            <Button size="sm" onClick={() => navigate("/auth")} className="gap-1.5 text-sm">
              Get Started
              <ChevronRight className="size-3.5" />
            </Button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative overflow-hidden">
        {/* Subtle grid background */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(0,0,0,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(0,0,0,0.02)_1px,transparent_1px)] bg-[size:40px_40px] dark:bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)]" />

        <div className="relative mx-auto max-w-6xl px-4 sm:px-6 pt-20 sm:pt-28 pb-16 sm:pb-24">
          <motion.div {...fadeUp} className="text-center max-w-3xl mx-auto">
            <Badge variant="outline" className="text-xs font-medium mb-6 gap-1.5">
              <Zap className="size-3 text-primary" />
              Trading Intelligence Agent
            </Badge>

            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.1]">
              Multi-Factor Market
              <br />
              <span className="text-primary">Bias Analysis</span>
            </h1>

            <p className="mt-5 text-base sm:text-lg text-muted-foreground leading-relaxed max-w-2xl mx-auto">
              Structured, auditable trading analysis combining technicals, fundamentals, sentiment,
              and positioning — with transparent scoring and explicit confidence levels.
            </p>

            <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
              <Button
                size="lg"
                onClick={() => navigate("/auth")}
                className="gap-2 px-7 text-sm font-semibold"
              >
                Start Analyzing
                <ChevronRight className="size-4" />
              </Button>
              <Button
                variant="outline"
                size="lg"
                onClick={() => navigate("/auth")}
                className="gap-2 px-7 text-sm"
              >
                Try as Guest
              </Button>
            </div>

            {/* Supported instruments */}
            <div className="mt-10 flex items-center justify-center gap-2 flex-wrap">
              <span className="text-xs text-muted-foreground">Supports:</span>
              {INSTRUMENTS.map((s) => (
                <Badge key={s} variant="secondary" className="text-[11px] font-mono">
                  {s}
                </Badge>
              ))}
              <Badge variant="secondary" className="text-[11px] font-mono">
                + any instrument
              </Badge>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Features Section */}
      <section className="border-t border-border/40 bg-muted/20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-16 sm:py-20">
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-12"
          >
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">How It Works</h2>
            <p className="mt-2 text-sm text-muted-foreground max-w-lg mx-auto">
              A transparent methodology — every analysis comes with a traceable score breakdown, so
              you always know why.
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
                <Card className="h-full border-border/50 bg-card/50 hover:bg-card transition-colors">
                  <CardContent className="p-5">
                    <div className={`flex size-9 items-center justify-center rounded-lg ${f.bg} mb-3`}>
                      <f.icon className={`size-4.5 ${f.color}`} />
                    </div>
                    <h3 className="text-sm font-semibold">{f.title}</h3>
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

      {/* Bias Methodology Section */}
      <section className="border-t border-border/40">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-16 sm:py-20">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
            >
              <Badge variant="outline" className="text-xs mb-4 gap-1.5">
                <BarChart3 className="size-3 text-primary" />
                Weighted Scoring
              </Badge>
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
                Transparent Bias
                <br />
                Methodology
              </h2>
              <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
                Each analysis scores four factors from -2 (very bearish) to +2 (very bullish),
                weighted and combined into a final directional bias. Every conclusion is traceable
                back to its components.
              </p>

              <div className="mt-6 space-y-3">
                {[
                  { label: "Structure & Trend", weight: "30%", color: "bg-primary" },
                  { label: "Indicator Confirmation", weight: "25%", color: "bg-blue-500" },
                  { label: "Fundamentals & Catalysts", weight: "25%", color: "bg-emerald-500" },
                  { label: "Sentiment & Positioning", weight: "20%", color: "bg-violet-500" },
                ].map((f) => (
                  <div key={f.label} className="flex items-center gap-3">
                    <div className={`h-2 rounded-full ${f.color}`} style={{ width: f.weight }} />
                    <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">
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
                  className="flex items-start gap-3 rounded-xl border border-border/50 bg-card/30 p-4"
                >
                  <span className="text-lg mt-0.5">{item.icon}</span>
                  <div>
                    <p className="text-sm font-semibold">{item.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{item.desc}</p>
                  </div>
                </motion.div>
              ))}
            </motion.div>
          </div>
        </div>
      </section>

      {/* Disclaimer Banner */}
      <section className="border-t border-border/40 bg-amber-500/5">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8">
          <div className="flex items-start gap-3 max-w-2xl mx-auto text-center flex-col items-center">
            <AlertTriangle className="size-5 text-amber-500" />
            <div>
              <p className="text-sm font-semibold text-amber-600 dark:text-amber-400">
                Not Financial Advice
              </p>
              <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                TradeEdge is a decision-support tool. It does not execute trades, guarantee profits,
                or provide licensed financial advice. Always do your own research and use proper risk
                management.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="border-t border-border/40">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-16 sm:py-20 text-center">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
            Start your analysis in seconds
          </h2>
          <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto">
            No complex setup. Pick an instrument, optionally add market data, and get a structured
            bias with full traceability.
          </p>
          <div className="mt-6 flex items-center justify-center gap-3">
            <Button size="lg" onClick={() => navigate("/auth")} className="gap-2 px-7 text-sm font-semibold">
              Get Started Free
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/40 py-6">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="flex size-6 items-center justify-center rounded-md bg-primary/10">
              <Zap className="size-3 text-primary" />
            </div>
            <span className="text-xs font-semibold">
              Trade<span className="text-primary">Edge</span>
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground">
            © {new Date().getFullYear()} TradeEdge · Decision-support tool, not financial advice
          </p>
        </div>
      </footer>
    </div>
  );
}
