import { motion } from "framer-motion";
import { useI18n } from "@/lib/i18n";

export default function NotFound() {
  const { t } = useI18n();
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
      className="min-h-screen flex flex-col"
    >

      
      {/* Main Content */}
      <div className="flex-1 flex flex-col items-center justify-center">
        <div className="max-w-5xl mx-auto relative px-4">
          <div className="flex items-center justify-center min-h-[200px]">
            <div className="text-center">
              <h1 className="text-4xl font-bold text-gray-900 mb-4">{t.dashboard.notFound}</h1>
              <p className="text-lg text-gray-600">{t.dashboard.pageNotFound}</p>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
