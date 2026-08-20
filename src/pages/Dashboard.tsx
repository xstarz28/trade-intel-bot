import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { InstrumentInput } from "@/components/InstrumentInput";
import { AnalysisResultDisplay } from "@/components/AnalysisResult";
import { AnalysisHistory } from "@/components/AnalysisHistory";
import { useAuth } from "@/hooks/use-auth";
import { runAnalysis, type AnalysisInput } from "@/lib/analysis-engine";
import type { AnalysisResult } from "@/types/analysis";
import { LogOut, Shield, Zap, History } from "lucide-react";
import { useNavigate } from "react-router";
import { motion, AnimatePresence } from "framer-motion";

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [currentResult, setCurrentResult] = useState<AnalysisResult | null>(null);
  const [history, setHistory] = useState<AnalysisResult[]>([]);

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  const handleAnalyze = useCallback(
    (input: AnalysisInput) => {
      setIsAnalyzing(true);
      setCurrentResult(null);

      // Simulate a brief processing delay for UX
      setTimeout(() => {
        const result = runAnalysis(input);
        setCurrentResult(result);
        setHistory((prev) => [result, ...prev]);
        setIsAnalyzing(false);
      }, 800);
    },
    []
  );

  const handleSelectHistory = useCallback((analysis: AnalysisResult) => {
    setCurrentResult(analysis);
  }, []);

  return (
    <div className="min-h-screen bg-background">
      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10">
              <Zap className="size-4 text-primary" />
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-tight">
                Trade<span className="text-primary">Edge</span>
              </h1>
              <p className="text-[10px] text-muted-foreground -mt-0.5">Trading Intelligence</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Shield className="size-3" />
              <span>Decision-support tool · Not financial advice</span>
            </div>
            <Separator orientation="vertical" className="h-5 hidden sm:block" />
            <span className="text-xs text-muted-foreground hidden sm:block">
              {user?.name || user?.email || "Trader"}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSignOut}
              className="gap-1.5 text-muted-foreground hover:text-foreground"
            >
              <LogOut className="size-3.5" />
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto max-w-7xl px-4 sm:px-6 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column — Input + History */}
          <div className="lg:col-span-4 space-y-4">
            <InstrumentInput onAnalyze={handleAnalyze} isAnalyzing={isAnalyzing} />

            {/* History — Desktop */}
            <div className="hidden lg:block">
              <AnalysisHistory
                analyses={history}
                onSelect={handleSelectHistory}
                selectedId={currentResult?.id}
              />
            </div>
          </div>

          {/* Right Column — Results */}
          <div className="lg:col-span-8">
            <AnimatePresence mode="wait">
              {isAnalyzing ? (
                <motion.div
                  key="loading"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="flex flex-col items-center justify-center py-24 text-center"
                >
                  <div className="relative">
                    <div className="size-16 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Zap className="size-6 text-primary" />
                    </div>
                  </div>
                  <p className="mt-6 text-sm font-medium text-foreground">
                    Running multi-factor analysis...
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Evaluating technicals, fundamentals, sentiment, and positioning
                  </p>
                </motion.div>
              ) : currentResult ? (
                <motion.div
                  key={currentResult.id}
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.3 }}
                >
                  <AnalysisResultDisplay result={currentResult} />
                </motion.div>
              ) : (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex flex-col items-center justify-center py-24 text-center"
                >
                  <div className="flex size-16 items-center justify-center rounded-2xl bg-muted/50 mb-4">
                    <Zap className="size-7 text-muted-foreground/50" />
                  </div>
                  <h3 className="text-base font-semibold text-foreground">
                    Ready to analyze
                  </h3>
                  <p className="mt-1.5 text-sm text-muted-foreground max-w-sm">
                    Select a popular instrument or enter one manually. Add price data and
                    market context for higher-confidence analysis.
                  </p>
                  <div className="mt-6 grid grid-cols-3 gap-3 max-w-sm">
                    <div className="rounded-lg bg-muted/30 border border-border/50 px-3 py-2.5 text-center">
                      <p className="text-lg font-bold text-primary">4</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">Factor Weights</p>
                    </div>
                    <div className="rounded-lg bg-muted/30 border border-border/50 px-3 py-2.5 text-center">
                      <p className="text-lg font-bold text-primary">5</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">Timeframes</p>
                    </div>
                    <div className="rounded-lg bg-muted/30 border border-border/50 px-3 py-2.5 text-center">
                      <p className="text-lg font-bold text-primary">∞</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">Instruments</p>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* History — Mobile */}
            <div className="lg:hidden mt-6">
              <AnalysisHistory
                analyses={history}
                onSelect={handleSelectHistory}
                selectedId={currentResult?.id}
              />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
