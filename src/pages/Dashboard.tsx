import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { InstrumentInput } from "@/components/InstrumentInput";
import { AnalysisResultDisplay } from "@/components/AnalysisResult";
import { AnalysisHistory } from "@/components/AnalysisHistory";
import { useAuth } from "@/hooks/use-auth";
import { runAnalysis, type AnalysisInput } from "@/lib/analysis-engine";
import type { AnalysisResult } from "@/types/analysis";
import { api } from "@/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { LogOut, Terminal, Zap } from "lucide-react";
import { useNavigate } from "react-router";
import { motion, AnimatePresence } from "framer-motion";

/** Convert a Convex DB record to the AnalysisResult shape used by the UI. */
function fromDbRecord(record: any): AnalysisResult {
  return {
    id: record._id,
    instrument: record.instrument,
    instrumentType: record.instrumentType,
    timeframe: record.timeframe,
    bias: record.bias,
    confidence: record.confidence,
    technicalSummary: record.technicalSummary,
    fundamentalSummary: record.fundamentalSummary,
    breakdown: record.breakdown,
    keyLevels: record.keyLevels,
    riskNote: record.riskNote,
    dataCompleteness: record.dataCompleteness,
    dataFlags: record.dataFlags,
    timestamp: record.timestamp,
  };
}

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [currentResult, setCurrentResult] = useState<AnalysisResult | null>(null);

  // Convex persistence
  const saveAnalysis = useMutation(api.analyses.save);
  const dbHistory = useQuery(api.analyses.list);

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  const handleAnalyze = useCallback(
    (input: AnalysisInput) => {
      setIsAnalyzing(true);
      setCurrentResult(null);

      // Brief processing delay for UX
      setTimeout(async () => {
        const result = runAnalysis(input);
        setCurrentResult(result);
        setIsAnalyzing(false);

        // Persist to Convex (fire-and-forget, don't block UI)
        try {
          await saveAnalysis({
            instrument: result.instrument,
            instrumentType: result.instrumentType,
            timeframe: result.timeframe,
            bias: result.bias,
            confidence: result.confidence,
            technicalSummary: result.technicalSummary,
            fundamentalSummary: result.fundamentalSummary,
            breakdown: result.breakdown,
            keyLevels: result.keyLevels,
            riskNote: result.riskNote,
            dataCompleteness: result.dataCompleteness,
            dataFlags: result.dataFlags,
          });
        } catch {
          // Save failed (e.g. guest user) — analysis still shows in UI session
        }
      }, 800);
    },
    [saveAnalysis],
  );

  const handleSelectHistory = useCallback((analysis: AnalysisResult) => {
    setCurrentResult(analysis);
  }, []);

  // Map DB records to AnalysisResult; fall back to empty array while loading
  const history: AnalysisResult[] = dbHistory
    ? dbHistory.map(fromDbRecord)
    : [];

  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary/15">
              <Terminal className="size-4 text-primary" />
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-tight font-mono">
                gilfan<span className="text-primary">/</span>trading-agent
              </h1>
              <p className="text-[10px] text-muted-foreground -mt-0.5 font-mono">bias analysis</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-muted-foreground font-mono hidden sm:block">
              {user?.name || user?.email || "guest"}
            </span>
            <Separator orientation="vertical" className="h-5 hidden sm:block" />
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSignOut}
              className="gap-1.5 text-muted-foreground hover:text-foreground"
            >
              <LogOut className="size-3.5" />
              <span className="hidden sm:inline text-xs font-mono">exit</span>
            </Button>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="mx-auto max-w-7xl px-4 sm:px-6 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left — Input + History */}
          <div className="lg:col-span-4 space-y-4">
            <InstrumentInput onAnalyze={handleAnalyze} isAnalyzing={isAnalyzing} />

            <div className="hidden lg:block">
              <AnalysisHistory
                analyses={history}
                onSelect={handleSelectHistory}
                selectedId={currentResult?.id}
              />
            </div>
          </div>

          {/* Right — Results */}
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
                  <p className="mt-6 text-sm font-medium text-foreground font-mono">
                    Running multi-factor analysis...
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground font-mono">
                    Evaluating structure · indicators · fundamentals · sentiment
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
                    <Terminal className="size-7 text-muted-foreground/40" />
                  </div>
                  <h3 className="text-base font-semibold text-foreground font-mono">
                    Ready
                  </h3>
                  <p className="mt-1.5 text-sm text-muted-foreground max-w-sm font-mono">
                    Pick an instrument or enter one manually. Add price data and market
                    context to improve confidence.
                  </p>
                  <div className="mt-6 grid grid-cols-3 gap-3 max-w-sm">
                    <div className="rounded-lg bg-muted/30 border border-border/50 px-3 py-2.5 text-center">
                      <p className="text-lg font-bold text-primary font-mono">4</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">factors</p>
                    </div>
                    <div className="rounded-lg bg-muted/30 border border-border/50 px-3 py-2.5 text-center">
                      <p className="text-lg font-bold text-primary font-mono">5</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">timeframes</p>
                    </div>
                    <div className="rounded-lg bg-muted/30 border border-border/50 px-3 py-2.5 text-center">
                      <p className="text-lg font-bold text-primary font-mono">∞</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">instruments</p>
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
