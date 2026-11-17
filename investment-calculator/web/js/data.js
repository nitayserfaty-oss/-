/*
 * Historical data used by the calculator.
 * All figures are annual percentage changes (nominal).
 *
 * Sources (summarised – see the "נתונים" screen in the app):
 *  - S&P 500 total return (incl. dividends, USD): A. Damodaran, NYU Stern, "Historical returns" dataset. 2025 – estimate.
 *  - Israel CPI (Dec/Dec): Central Bureau of Statistics (CBS / הלמ"ס).
 *  - Israel dwelling price index: CBS "מדד מחירי הדירות". Annual values are approximate (rounded),
 *    calendar-year changes differ slightly between publications.
 *  - TA-125 price index: Tel Aviv Stock Exchange. Pre-2017 values are approximate.
 *  - USD/ILS: Bank of Israel representative rate, end of year.
 *
 * Numbers are for educational modelling only – please verify before making decisions.
 */
(function (root) {
  'use strict';

  // S&P 500 total return, 1928..2025
  const SP500_START = 1928;
  const SP500 = [
    43.81, -8.30, -25.12, -43.84, -8.64, 49.98, -1.19, 46.74, 31.94, -35.34, // 1928-1937
    29.28, -1.10, -10.67, -12.77, 19.17, 25.06, 19.03, 35.82, -8.43, 5.20,   // 1938-1947
    5.70, 18.30, 30.81, 23.68, 18.15, -1.21, 52.56, 32.60, 7.44, -10.46,     // 1948-1957
    43.72, 12.06, 0.34, 26.64, -8.81, 22.61, 16.42, 12.40, -9.97, 23.80,     // 1958-1967
    10.81, -8.24, 3.56, 14.22, 18.76, -14.31, -25.90, 37.00, 23.83, -6.98,   // 1968-1977
    6.51, 18.52, 31.74, -4.70, 20.42, 22.34, 6.15, 31.24, 18.49, 5.81,       // 1978-1987
    16.54, 31.48, -3.06, 30.23, 7.49, 9.97, 1.33, 37.20, 22.68, 33.10,       // 1988-1997
    28.34, 20.89, -9.03, -11.85, -21.97, 28.36, 10.74, 4.83, 15.61, 5.48,    // 1998-2007
    -36.55, 25.94, 14.82, 2.10, 15.89, 32.15, 13.52, 1.38, 11.77, 21.61,     // 2008-2017
    -4.23, 31.21, 18.02, 28.47, -18.04, 26.06, 24.88, 17.9                   // 2018-2025
  ];

  // Israel – aligned series 1995..2025
  const IL_START = 1995;
  const IL_CPI = [
    8.1, 10.6, 7.0, 8.6, 1.3, 0.0, 1.4, 6.5, -1.9, 1.2,      // 1995-2004
    2.4, -0.1, 3.4, 3.8, 3.9, 2.7, 2.2, 1.6, 1.8, -0.2,      // 2005-2014
    -1.0, -0.2, 0.4, 0.8, 0.6, -0.7, 2.8, 5.3, 3.0, 3.2,     // 2015-2024
    2.5                                                     // 2025
  ];
  // Dwelling price index (approx.)
  const IL_HOUSING = [
    9.0, 13.0, 9.0, 5.0, 3.0, -1.0, -2.0, 4.0, -3.0, -1.0,   // 1995-2004
    2.0, -1.0, 3.0, 7.0, 17.0, 15.0, 6.0, 6.0, 8.0, 5.0,     // 2005-2014
    8.0, 6.5, 2.0, -0.5, 2.5, 4.0, 11.0, 17.0, -1.5, 7.0,    // 2015-2024
    1.5                                                     // 2025
  ];
  // USD/ILS end-of-year rate, 1994..2025 (one extra leading year to compute 1995 change)
  const USDILS = [
    3.018, 3.135, 3.251, 3.536, 4.160, 4.153, 4.041, 4.416, 4.737, 4.379, 4.308, // 1994-2004
    4.603, 4.225, 3.846, 3.802, 3.775, 3.549, 3.821, 3.733, 3.471, 3.889,        // 2005-2014
    3.902, 3.845, 3.467, 3.748, 3.456, 3.215, 3.110, 3.519, 3.627, 3.647,        // 2015-2024
    3.20                                                                         // 2025
  ];
  // TA-125 price index (approx.), 2008..2025
  const TA125_START = 2008;
  const TA125 = [
    -50.0, 86.0, 15.6, -20.3, 7.6, 15.0, 6.5, 1.9, -2.0, 6.54, // 2008-2017
    -2.42, 21.27, -1.5, 27.6, -12.0, 4.9, 30.0, 50.0           // 2018-2025
  ];

  function series(start, arr) {
    return arr.map(function (v, i) { return { year: start + i, value: v }; });
  }

  const usdIlsChange = [];
  for (let i = 1; i < USDILS.length; i++) {
    usdIlsChange.push(+((USDILS[i] / USDILS[i - 1] - 1) * 100).toFixed(2));
  }
  // S&P 500 in ILS terms (1995..2025)
  const sp500Ils = [];
  for (let y = IL_START; y <= 2025; y++) {
    const r = SP500[y - SP500_START] / 100;
    const fx = usdIlsChange[y - IL_START] / 100;
    sp500Ils.push(+(((1 + r) * (1 + fx) - 1) * 100).toFixed(2));
  }

  const HISTORY = {
    sp500: { name: 'S&P 500 (תשואה כוללת, דולר)', short: 'S&P 500', start: SP500_START, data: SP500, approx: false,
      source: 'Damodaran, NYU Stern (2025 – הערכה)' },
    sp500Ils: { name: 'S&P 500 בשקלים (כולל שינוי שער הדולר)', short: 'S&P 500 ₪', start: IL_START, data: sp500Ils, approx: false,
      source: 'Damodaran + בנק ישראל (שער יציג)' },
    ta125: { name: 'ת"א-125 (מדד מחיר)', short: 'ת"א-125', start: TA125_START, data: TA125, approx: true,
      source: 'הבורסה לניירות ערך בת"א (ערכים משוערים)' },
    housing: { name: 'מדד מחירי הדירות בישראל', short: 'דירות', start: IL_START, data: IL_HOUSING, approx: true,
      source: 'הלמ"ס – מדד מחירי הדירות (ערכים שנתיים משוערים)' },
    cpi: { name: 'אינפלציה בישראל (מדד המחירים לצרכן)', short: 'אינפלציה', start: IL_START, data: IL_CPI, approx: false,
      source: 'הלמ"ס' },
    usdils: { name: 'שינוי שער הדולר מול השקל', short: 'דולר/שקל', start: IL_START, data: usdIlsChange, approx: false,
      source: 'בנק ישראל' }
  };

  // Israeli tax & regulation constants (2025-2026)
  const TAX = {
    capitalGains: 25,        // מס רווחי הון
    dividends: 25,           // מס דיבידנד (ליחיד)
    rentFlat: 10,            // מסלול 10% על הכנסה משכירות
    rentExemptCeiling: 5654, // תקרת פטור חודשית לשכירות למגורים (2025, משוער)
    landAppreciation: 25,    // מס שבח (ריאלי) לדירה שאינה פטורה
    vat: 18,
    // מדרגות מס רכישה – דירה יחידה (2025-2027, מוקפא)
    purchaseSingle: [
      [1978745, 0], [2347040, 3.5], [6055070, 5], [20183565, 8], [Infinity, 10]
    ],
    // מדרגות מס רכישה – דירה נוספת
    purchaseAdditional: [
      [6055070, 8], [Infinity, 10]
    ],
    maxLtvSingle: 75,
    maxLtvAdditional: 50,
    maxLtvUpgrade: 70
  };

  const api = { HISTORY: HISTORY, TAX: TAX, series: series };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.InvestData = api;
})(typeof window !== 'undefined' ? window : globalThis);
