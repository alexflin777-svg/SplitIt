import { useState } from 'react';
import { Camera, Zap, Users, ArrowRight, CheckCircle2 } from 'lucide-react';
import { completeOnboarding } from '@/lib/supabase';

export function OnboardingTour({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState(0);
  const [isCompleting, setIsCompleting] = useState(false);

  const slides = [
    {
      title: 'Welcome to SplitIT',
      description: 'The easiest way to track and settle shared expenses with friends, roommates, or travel buddies.',
      icon: <Users className="w-12 h-12 text-blue-500" />,
      color: 'bg-blue-100 dark:bg-blue-900/30'
    },
    {
      title: 'AI Receipt Scanner',
      description: 'Snap a photo of any receipt. Our AI automatically extracts items, prices, and taxes in seconds.',
      icon: <Camera className="w-12 h-12 text-purple-500" />,
      color: 'bg-purple-100 dark:bg-purple-900/30'
    },
    {
      title: 'Smart Debt Simplification',
      description: 'We calculate who owes what and simplify the debts to minimize the number of transfers.',
      icon: <Zap className="w-12 h-12 text-amber-500" />,
      color: 'bg-amber-100 dark:bg-amber-900/30'
    }
  ];

  const handleNext = () => {
    if (step < slides.length - 1) {
      setStep(step + 1);
    } else {
      handleFinish();
    }
  };

  const handleFinish = async () => {
    setIsCompleting(true);
    await completeOnboarding();
    setIsCompleting(false);
    onComplete();
  };

  const currentSlide = slides[step];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="w-full max-w-sm bg-white dark:bg-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col slide-in-from-bottom-8 duration-500">
        
        {/* Illustration Area */}
        <div className={`h-48 flex items-center justify-center transition-colors duration-500 ${currentSlide.color}`}>
          <div className="p-4 bg-white dark:bg-slate-800 rounded-2xl shadow-sm animate-in zoom-in-75 duration-300">
            {currentSlide.icon}
          </div>
        </div>

        {/* Content Area */}
        <div className="p-6 text-center space-y-4">
          <div className="space-y-2 h-24">
            <h3 className="text-xl font-extrabold text-slate-900 dark:text-white">
              {currentSlide.title}
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
              {currentSlide.description}
            </p>
          </div>

          {/* Progress Dots */}
          <div className="flex items-center justify-center gap-2 pt-4">
            {slides.map((_, i) => (
              <div 
                key={i} 
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  i === step ? 'w-6 bg-blue-600' : 'w-1.5 bg-slate-200 dark:bg-slate-700'
                }`} 
              />
            ))}
          </div>

          {/* Action Button */}
          <div className="pt-6">
            <button
              onClick={handleNext}
              disabled={isCompleting}
              className="w-full py-3.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-sm shadow-md shadow-blue-500/20 transition-all active:scale-98 flex items-center justify-center gap-2"
            >
              {step < slides.length - 1 ? (
                <>
                  <span>Next</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              ) : (
                <>
                  <span>Get Started</span>
                  <CheckCircle2 className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
