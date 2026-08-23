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
import { useNavigate } from "react-router";

const FEATURES = [
  {
    icon: Layers,
    title: "Market Structure & Liquidity",
    description:
      "BOS / CHoCH detection, swing structure, internal vs external liquidity, equal highs/lows, sweeps, dan buy-side/sell-side liquidity pools — dibaca langsung dari data candle multi-timeframe.",
    color: "text-primary",
    bg: "bg-primary/10",
  },
  {
    icon: Waves,
    title: "Supply, Demand & Imbalance",
    description:
      "Order block tervalidasi displacement, Fair Value Gap (FVG), imbalance, mitigation & reaction area — bukan zona acak, tapi area harga institusional dengan alasan yang bisa ditelusuri.",
    color: "text-blue-400",
    bg: "bg-blue-400/10",
  },
  {
    icon: Crosshair,
    title: "Multi-Timeframe Top-Down",
    description:
      "W1 → D1 → H4 → H1 → M15/M5. HTF menentukan macro bias & liquidity pool; LTF untuk konfirmasi sweep, BOS, entry refinement, dan invalidation placement.",
    color: "text-emerald-400",
    bg: "bg-emerald-400/10",
  },
  {
    icon: Scale,
    title: "Positioning & Flow",
    description:
      "Funding rate, open interest, liquidation cascade, long/short ratio untuk crypto. Kalender ekonomi high-impact, DXY, real yields, dan risk sentiment untuk makro.",
    color: "text-violet-400",
    bg: "bg-violet-400/10",
  },
];

const INSTRUMENTS = ["EUR/USD", "BTC/USD", "XAU/USD", "US30", "NVDA", "WTI"];

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
              XstarzG<span className="text-muted-foreground"> · </span>
              <span className="text-primary">Trader</span>
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
              Chief Market Strategist · institutional-grade AI
            </Badge>

            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.1] font-mono">
              <span className="text-primary">XstarzG</span>{" "}
              <span className="text-foreground">Trader</span>
              <br />
              <span className="text-lg sm:text-xl lg:text-2xl font-semibold text-muted-foreground">
                Chief Market Strategist
              </span>
            </h1>

            <p className="mt-6 text-sm sm:text-base text-muted-foreground leading-relaxed max-w-xl mx-auto font-mono">
              Analisis market presisi tinggi: price action, structure, liquidity,
              volume &amp; fundamental makro — tajam, berbasis data, tanpa sinyal generik.
              Conviction selalu proporsional dengan confluence yang ada.
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

            {/* Supported asset classes */}
            <div className="mt-10 flex items-center justify-center gap-2 flex-wrap">
              <span className="text-[11px] text-muted-foreground font-mono">$ coverage:</span>
              {["crypto", "forex", "saham", "komoditas", "index futures"].map((s) => (
                <Badge key={s} variant="secondary" className="text-[11px] font-mono border-border/50">
                  {s}
                </Badge>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-center gap-2 flex-wrap">
              <span className="text-[11px] text-muted-foreground font-mono">$ instruments:</span>
              {INSTRUMENTS.map((s) => (
                <Badge key={s} variant="outline" className="text-[11px] font-mono border-primary/25 text-primary/90">
                  {s}
                </Badge>
              ))}
              <Badge variant="outline" className="text-[11px] font-mono border-border/50">
                + any symbol
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
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight font-mono">Analytical Framework</h2>
            <p className="mt-2 text-sm text-muted-foreground max-w-lg mx-auto font-mono">
              Indikator textbook lama bukan fondasi. Setiap bias dibangun dari
              structure, liquidity, supply/demand, volume &amp; positioning — dengan evidence yang bisa ditelusuri.
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
                <Brain className="size-3" /> conviction framework
              </Badge>
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight font-mono">
                Conviction Level,
                <br />
                Bukan Klaim Akurasi
              </h2>
              <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
                Tidak ada setup dengan winrate pasti. Conviction High/Medium/Low
                mencerminkan kekuatan confluence aktual — structure + liquidity +
                supply/demand + fundamental yang saling menguatkan. Jika confluence
                tidak cukup dan ada conflicting evidence signifikan, jawabannya
                adalah NO TRADE — bukan setup yang dipaksakan.
              </p>

              <div className="mt-6 space-y-3">
                {[
                  { label: "Structure & Trend (BOS/CHoCH)", weight: "35%", color: "bg-primary" },
                  { label: "Liquidity & Supply/Demand", weight: "30%", color: "bg-blue-400" },
                  { label: "Fundamental & Katalis Makro", weight: "20%", color: "bg-emerald-400" },
                  { label: "Sentiment & Positioning", weight: "15%", color: "bg-violet-400" },
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
                  label: "Technical Thesis",
                  desc: "Struktur pasar, BOS/CHoCH, liquidity zones, order block/FVG, level kunci",
                  icon: "📊",
                },
                {
                  label: "Fundamental Catalyst",
                  desc: "Kebijakan moneter, kalender ekonomi, positioning data — relevan dengan timeframe",
                  icon: "📰",
                },
                {
                  label: "Trade Plan",
                  desc: "Entry, SL/invalidation, take profit, R:R, saran position sizing per risk per trade",
                  icon: "🎯",
                },
                {
                  label: "Conviction & Reasoning",
                  desc: "High/Medium/Low conviction dengan setiap alasan teknikal & fundamental terbuka",
                  icon: "⚖️",
                },
                {
                  label: "Invalidation",
                  desc: "Level/kondisi eksplisit yang membatalkan thesis — wajib di setiap output",
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

      {/* Non-negotiables */}
      <section className="border-t border-border/40">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-14">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              {
                icon: Ban,
                title: "No Fabricated Data",
                desc: "Jika tools/API tidak menyediakan data, kami katakan secara eksplisit — tidak pernah mengarang harga, level, atau berita.",
              },
              {
                icon: Shield,
                title: "Capital First",
                desc: "Preservation of capital dan kualitas setup di atas frekuensi entry. Position sizing selalu berbasis risk per trade.",
              },
              {
                icon: Target,
                title: "No Auto-Execution",
                desc: "Tidak ada order otomatis tanpa konfirmasi eksplisit Anda. Ini decision-support, bukan mesin eksekusi.",
              },
            ].map((item) => (
              <div key={item.title} className="rounded-lg border border-border/50 bg-card/40 p-5">
                <item.icon className="size-5 text-primary mb-3" />
                <h3 className="text-sm font-semibold font-mono">{item.title}</h3>
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
            <AlertTriangle className="size-5 text-amber-500" />
            <div>
              <p className="text-sm font-semibold text-amber-400 font-mono">
                Not Financial Advice
              </p>
              <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                XstarzG Trader adalah decision-support tool. Tidak mengeksekusi trade,
                tidak menjamin profit, dan bukan nasihat keuangan berlisensi.
                Selalu verifikasi independen dan kelola risiko Anda sendiri.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-border/40">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-16 sm:py-20 text-center">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight font-mono">
            One instrument. Full thesis. Traceable reasoning.
          </h2>
          <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto font-mono">
            Submit instrumen apa pun — dapatkan bias, level kunci, trade plan,
            dan invalidation dengan setiap langkah analisis yang transparan.
          </p>
          <div className="mt-6 flex items-center justify-center gap-3">
            <Button size="lg" onClick={() => navigate("/auth")} className="gap-2 px-7 text-sm font-semibold font-mono">
              Launch Strategist
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
              XstarzG<span className="text-muted-foreground"> · </span>
              <span className="text-primary">Trader</span>
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground font-mono">
            Chief Market Strategist · Decision-support tool · Not financial advice
          </p>
        </div>
      </footer>
    </div>
  );
}
