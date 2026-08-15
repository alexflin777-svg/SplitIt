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

      // ВЫКЛЮЧЕНО ВРЕМЕННО.
      // Причина: 7 мест читают сессию/локальные данные после монтирования
      // (auth, events/new, friends, invite, profile, EventDetailClient,
      // i18n/provider) — стандартный для статического экспорта паттерн
      // гидратации. Переход на useSyncExternalStore — отдельная задача P1-6
      // в todo.md, а не правка ради зелёного линта.
      // Дата возврата: закрытие P1-6, крайний срок пересмотра 2026-09-15.
      "react-hooks/set-state-in-effect": "off",

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
