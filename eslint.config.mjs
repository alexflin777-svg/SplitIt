import nextVitals from "eslint-config-next/core-web-vitals";

// Правило гейта: скрипт `lint` в package.json обязан запускать этот конфиг.
// Заглушка вида `echo ...` вместо eslint запрещена и проверяется шагом
// «гейт не подменён» в .github/workflows/gate.yml.
//
// Любое "off" ниже обязано иметь причину и дату возврата. Без даты — не
// принимается: см. _review/2026-08-15/10-PROCESS-RECOMMENDATIONS.md §A2.
const config = [
  {
    ignores: [
      ".next/**",
      "out/**",
      "node_modules/**",
      "android/**",
      "ios/**",
    ],
  },
  ...nextVitals,
  {
    rules: {
      // Включены обратно 2026-08-15 после правки кода:
      //   immutability — HeaderNavLabel мутировал document.documentElement.lang
      //                  прямо в рендере (перенесено в useEffect); SettleUpClient
      //                  вызывал сеттеры, объявленные ниже по файлу (объявления
      //                  подняты над эффектом);
      //   purity       — EventDetailClient подставлял Date.now() как дату расхода
      //                  в рендере: выдуманное значение и расхождение гидратации.
      //                  Fallback убран. Осталось одно точечное подавление
      //                  правила на генерации id участника в обработчике —
      //                  с объяснением на месте.
      "react-hooks/immutability": "error",
      "react-hooks/purity": "error",

      // Включено 2026-10-09 (T4 цикла «Launch hardening 1»): новый код
      // проверяется. Срок прошлого пересмотра (2026-09-15) был просрочен.
      // Семь старых мест (auth, events/new, friends, invite, profile,
      // EventDetailClient, i18n/provider) помечены точечными исключениями
      // на строке выше нарушения, с причиной и датой — P1-6 в todo.md.
      // Почему не переписаны сейчас: перевод i18n/provider на
      // useSyncExternalStore меняет момент появления локализованных подписей,
      // а на нём держатся E2E-локаторы, которые в этом же цикле
      // стабилизировались (T1). Делать обе правки разом — смешать причины.
      // Крайний срок: 2026-11-15 — после него исключения убираются или
      // продлеваются явно с новой причиной.
      "react-hooks/set-state-in-effect": "error",

      // exhaustive-deps держим предупреждением, но `--max-warnings=0`
      // означает, что предупреждение всё равно валит гейт.
      "react-hooks/exhaustive-deps": "warn",

      // <img> используется осознанно: статический экспорт без image-оптимизации
      // Next, аватары приходят из Supabase Storage. Пересмотреть, если появится
      // серверный рантайм.
      "@next/next/no-img-element": "off",
    },
  },
];

export default config;
