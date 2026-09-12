/**
 * Phase 182 — /terms.
 *
 * Part of the official-website surface. The three sections restate the
 * product's standing invariants in user-facing language: this is
 * decision support, it never executes a trade, and it never fabricates data
 * to cover a gap.
 */

import { motion } from "framer-motion";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

const SECTIONS = [
  { id: "not-advice", titleKey: "legal.termsNotAdviceTitle", bodyKey: "legal.termsNotAdviceBody" },
  { id: "no-execution", titleKey: "legal.termsNoExecutionTitle", bodyKey: "legal.termsNoExecutionBody" },
  { id: "accuracy", titleKey: "legal.termsAccuracyTitle", bodyKey: "legal.termsAccuracyBody" },
] as const;

export default function Terms() {
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
            {tx("legal.termsTitle")}
          </h1>
          <p className="mt-3 text-muted-foreground leading-relaxed">
            {tx("legal.termsIntro")}
          </p>

          <div className="mt-10 space-y-8">
            {SECTIONS.map((section) => (
              <section key={section.id}>
                <h2 className="font-medium">{tx(section.titleKey)}</h2>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                  {tx(section.bodyKey)}
                </p>
              </section>
            ))}
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
