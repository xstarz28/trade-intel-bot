import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { ChevronRight, Shield, Target, Layers, Scale, Waves } from "lucide-react";
import { useNavigate } from "react-router";

const FEATURES = [
  ["Market Structure", Layers, "BOS/CHoCH, swing structure, liquidity and key levels from actual OHLCV."],
  ["Supply & Demand", Waves, "Validated supply, demand, imbalance and reaction areas with traceable evidence."],
  ["Multi-Timeframe", Target, "Higher-timeframe context first, then setup and trigger confirmation."],
  ["Risk & Invalidation", Scale, "Entry, invalidation, targets and R:R stay tied to the same market snapshot."],
];

export default function Landing() {
  const navigate = useNavigate();
  return <div className="min-h-screen bg-background text-foreground">
    <header className="border-b border-border/60 bg-background">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
        <button onClick={() => navigate("/")} className="text-left">
          <div className="chrome-text text-xl font-semibold tracking-[0.18em]">XSTARZG</div>
          <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Market Analysis</div>
        </button>
        <nav className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => navigate("/pricing")}>Pricing</Button>
          <Button variant="outline" onClick={() => navigate("/auth")}>Sign in</Button>
        </nav>
      </div>
    </header>
    <main>
      <section className="panel-grid border-b border-border/60">
        <div className="mx-auto max-w-6xl px-5 py-24 sm:py-32">
          <motion.div initial={{opacity:0,y:16}} animate={{opacity:1,y:0}} className="max-w-3xl">
            <div className="mb-6 text-xs uppercase tracking-[0.28em] text-muted-foreground">Trading Intelligence</div>
            <h1 className="chrome-text text-5xl font-semibold tracking-tight sm:text-7xl">XSTARZG</h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-muted-foreground">
              Market analysis built from price structure, liquidity, macro evidence and risk.
              No fabricated prices. No forced setup. No automatic execution.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button size="lg" onClick={() => navigate("/auth")}>Start analysis <ChevronRight className="ml-1 size-4"/></Button>
              <Button size="lg" variant="outline" onClick={() => navigate("/pricing")}>View pricing</Button>
            </div>
          </motion.div>
        </div>
      </section>
      <section className="mx-auto max-w-6xl px-5 py-16">
        <div className="grid gap-4 sm:grid-cols-2">
          {FEATURES.map(([title, Icon, description]) => <div key={title as string} className="metal-panel p-6">
            <Icon className="mb-5 size-5 text-primary" />
            <h2 className="text-base font-semibold">{title as string}</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{description as string}</p>
          </div>)}
        </div>
      </section>
      <section className="border-y border-border/60 bg-card/30">
        <div className="mx-auto grid max-w-6xl gap-8 px-5 py-14 md:grid-cols-3">
          <div><p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Coverage</p><p className="mt-2 text-lg">Crypto · Forex · Stocks · Commodities · Indices</p></div>
          <div><p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Output</p><p className="mt-2 text-lg">Bias · Levels · Trade Plan · Invalidation</p></div>
          <div><p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Standard</p><p className="mt-2 text-lg">Evidence before conviction</p></div>
        </div>
      </section>
    </main>
    <footer className="border-t border-border/60">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-6 text-xs text-muted-foreground">
        <span className="chrome-text font-semibold tracking-[0.18em]">XSTARZG</span><span>Decision-support tool · Not financial advice</span>
      </div>
    </footer>
  </div>;
}