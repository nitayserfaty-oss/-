/*
 * Pure calculation engine – no DOM access. Usable from the browser and from Node (tests).
 * All rates in inputs are percentages (e.g. 4.5 means 4.5%). Money in ILS.
 */
(function (root) {
  'use strict';

  const D = (typeof module !== 'undefined' && module.exports) ? require('./data.js') : root.InvestData;
  const TAX = D.TAX;

  const pct = function (v) { return (Number(v) || 0) / 100; };
  const monthly = function (annualPct) { return Math.pow(1 + pct(annualPct), 1 / 12) - 1; };
  const monthlyFromRate = function (r) { return Math.pow(1 + r, 1 / 12) - 1; };

  /* ---------- Generic helpers ---------- */

  /** Annuity payment (Spitzer / שפיצר). r = monthly rate, n = months. */
  function pmt(r, n, principal) {
    if (n <= 0) return principal;
    if (Math.abs(r) < 1e-12) return principal / n;
    return principal * r / (1 - Math.pow(1 + r, -n));
  }

  /** Progressive bracket tax (used for purchase tax). brackets: [[upTo, pct], ...] */
  function bracketTax(amount, brackets) {
    let tax = 0, prev = 0;
    for (const b of brackets) {
      const top = b[0], rate = b[1];
      if (amount <= prev) break;
      const slice = Math.min(amount, top) - prev;
      tax += slice * rate / 100;
      prev = top;
    }
    return tax;
  }

  function purchaseTax(price, status) {
    if (status === 'none') return 0;
    return bracketTax(price, status === 'single' ? TAX.purchaseSingle : TAX.purchaseAdditional);
  }

  /** IRR for monthly cashflows (array, index = month). Returns annualized rate or NaN. */
  function irr(flows) {
    const npv = function (r) {
      let v = 0;
      for (let i = 0; i < flows.length; i++) if (flows[i]) v += flows[i] / Math.pow(1 + r, i);
      return v;
    };
    let lo = -0.08, hi = 0.15; // monthly
    let flo = npv(lo), fhi = npv(hi);
    if (isNaN(flo) || isNaN(fhi) || flo * fhi > 0) return NaN;
    for (let k = 0; k < 200; k++) {
      const mid = (lo + hi) / 2;
      const fm = npv(mid);
      if (Math.abs(fm) < 1e-6) { lo = hi = mid; break; }
      if (flo * fm < 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
    }
    const m = (lo + hi) / 2;
    return Math.pow(1 + m, 12) - 1;
  }

  /** Value of rate for year index y (0-based): either constant number or array. */
  function rateAt(rate, y) {
    if (Array.isArray(rate)) return rate[Math.min(y, rate.length - 1)];
    return rate;
  }

  /* ---------- Mortgage ---------- */

  /**
   * Simulate a mortgage track month by month.
   * opts: { amount, rate, years, type: 'spitzer'|'equal', indexed: bool }
   * infl: annual inflation (% number or array per year)
   */
  function mortgageSchedule(opts, infl) {
    const n = Math.round(opts.years * 12);
    const r = monthly(opts.rate);
    let bal = opts.amount;
    const rows = [];
    let totalInterest = 0, totalPaid = 0, totalIndexation = 0;
    for (let m = 0; m < n; m++) {
      const y = Math.floor(m / 12);
      if (opts.indexed) {
        const add = bal * monthly(rateAt(infl, y));
        bal += add; totalIndexation += add;
      }
      const remaining = n - m;
      const interest = bal * r;
      let principal, payment;
      if (opts.type === 'equal') {
        principal = bal / remaining;
        payment = principal + interest;
      } else {
        payment = pmt(r, remaining, bal);
        principal = payment - interest;
      }
      bal = Math.max(0, bal - principal);
      totalInterest += interest; totalPaid += payment;
      rows.push({ month: m + 1, payment: payment, interest: interest, principal: principal, balance: bal });
    }
    return { rows: rows, totalInterest: totalInterest, totalPaid: totalPaid, totalIndexation: totalIndexation,
      firstPayment: rows.length ? rows[0].payment : 0 };
  }

  /* ---------- Real estate ---------- */

  const RE_DEFAULTS = {
    price: 1500000,
    equity: 1000000,
    buyerStatus: 'additional',   // 'single' | 'additional' | 'none'
    purchaseTaxManual: '',       // optional override (₪)
    lawyerPct: 0.5,
    brokerBuyPct: 2,
    renovation: 30000,
    otherBuyCosts: 10000,        // שמאי, משכנתא-יועץ, פתיחת תיק
    mortgageRate: 4.8,
    mortgageYears: 25,
    mortgageType: 'spitzer',
    indexedShare: 0,             // % of loan linked to CPI
    rent: 4500,
    rentGrowth: 2.5,
    vacancyMonths: 0.5,
    maintenancePct: 5,           // % of annual rent
    managementPct: 0,
    insurance: 1500,             // ₪ per year
    landlordMonthly: 0,          // ועד בית / ארנונה בזמן ריק וכו'
    rentTax: 'exempt',           // 'exempt' | 'flat10' | 'custom'
    rentTaxCustom: 20,
    appreciation: 4,
    inflation: 2.5,
    sellBrokerPct: 2,
    sellLawyerPct: 0.5,
    capitalGainsExempt: false,
    surplusRate: 3.5,            // return on surplus cash-flow (פיקדון)
    years: 15
  };

  function buyCostsFor(p, price) {
    const vat = 1 + TAX.vat / 100;
    const manual = p.purchaseTaxManual !== '' && p.purchaseTaxManual != null && !isNaN(+p.purchaseTaxManual);
    const pTax = manual ? +p.purchaseTaxManual : purchaseTax(price, p.buyerStatus);
    const lawyer = price * pct(p.lawyerPct) * vat;
    const broker = price * pct(p.brokerBuyPct) * vat;
    return { purchaseTax: pTax, lawyer: lawyer, broker: broker,
      total: pTax + lawyer + broker + (+p.renovation || 0) + (+p.otherBuyCosts || 0) };
  }

  /** Highest property price reachable with `equity` while staying within the LTV limit. */
  function maxPriceForEquity(input, equity, ltvPct) {
    const p = Object.assign({}, RE_DEFAULTS, input);
    const ltv = pct(ltvPct != null ? ltvPct : (p.buyerStatus === 'single' ? TAX.maxLtvSingle : TAX.maxLtvAdditional));
    let lo = 0, hi = equity * 20;
    for (let i = 0; i < 80; i++) {
      const mid = (lo + hi) / 2;
      const loan = Math.max(0, mid + buyCostsFor(p, mid).total - equity);
      if (loan <= ltv * mid) lo = mid; else hi = mid;
    }
    return Math.floor(lo / 1000) * 1000;
  }

  /**
   * Real estate investment simulation.
   * Optional overrides in `paths`: { appreciation: [...], inflation: [...] } per-year arrays.
   */
  function simulateRealEstate(input, paths) {
    const p = Object.assign({}, RE_DEFAULTS, input);
    paths = paths || {};
    const appr = paths.appreciation || p.appreciation;
    const infl = paths.inflation || p.inflation;
    const rentGrowth = paths.rentGrowth || p.rentGrowth;
    const years = Math.max(1, Math.round(p.years));
    const months = years * 12;
    const vat = 1 + TAX.vat / 100;

    const bc = buyCostsFor(p, p.price);
    const pTax = bc.purchaseTax, lawyer = bc.lawyer, broker = bc.broker, buyCosts = bc.total;
    const totalCost = p.price + buyCosts;
    const loan = Math.max(0, totalCost - p.equity);
    const extraCash = Math.max(0, p.equity - totalCost); // equity not needed – kept as cash
    const ltv = p.price > 0 ? loan / p.price * 100 : 0;
    const maxLtv = p.buyerStatus === 'single' ? TAX.maxLtvSingle : TAX.maxLtvAdditional;

    // two tracks: unindexed + indexed
    const idxShare = pct(p.indexedShare);
    const tracks = [
      { bal: loan * (1 - idxShare), indexed: false },
      { bal: loan * idxShare, indexed: true }
    ];
    const n = Math.round(p.mortgageYears * 12);
    const rm = monthly(p.mortgageRate);

    let value = p.price;
    let rent = p.rent;
    let cpiFactor = 1;
    let side = extraCash;        // accumulated surplus cash (+ unused equity)
    let outOfPocket = 0;         // cumulative extra money investor had to add
    let totals = { rent: 0, expenses: 0, interest: 0, principal: 0, rentTax: 0, payments: 0 };
    const flows = new Array(months + 1).fill(0);
    flows[0] = -p.equity;
    const yearly = [];
    const monthlyDeficits = new Array(months).fill(0);
    let firstYearCash = 0;
    let insurance = p.insurance;
    let landlord = p.landlordMonthly;

    for (let m = 0; m < months; m++) {
      const y = Math.floor(m / 12);
      if (m > 0 && m % 12 === 0) {
        rent *= 1 + pct(rateAt(rentGrowth, y - 1));
        insurance *= 1 + pct(rateAt(infl, y - 1));
        landlord *= 1 + pct(rateAt(infl, y - 1));
      }
      const inflM = monthly(rateAt(infl, y));
      cpiFactor *= 1 + inflM;
      value *= 1 + monthly(rateAt(appr, y));

      const occupancy = Math.max(0, 12 - p.vacancyMonths) / 12;
      const effRent = rent * occupancy;
      const expenses = rent * pct(p.maintenancePct) + effRent * pct(p.managementPct) + insurance / 12 + landlord;
      let rentTax = 0;
      if (p.rentTax === 'flat10') rentTax = effRent * TAX.rentFlat / 100;
      else if (p.rentTax === 'custom') rentTax = Math.max(0, effRent - expenses) * pct(p.rentTaxCustom);

      // mortgage
      let payment = 0, interest = 0, principal = 0;
      if (m < n) {
        for (const t of tracks) {
          if (t.bal <= 0) continue;
          if (t.indexed) t.bal *= 1 + inflM;
          const remaining = n - m;
          const it = t.bal * rm;
          let pr, pay;
          if (p.mortgageType === 'equal') { pr = t.bal / remaining; pay = pr + it; }
          else { pay = pmt(rm, remaining, t.bal); pr = pay - it; }
          t.bal = Math.max(0, t.bal - pr);
          payment += pay; interest += it; principal += pr;
        }
      }

      const cash = effRent - expenses - rentTax - payment;
      if (y === 0) firstYearCash += cash;
      side *= 1 + monthly(p.surplusRate);
      if (cash >= 0) side += cash;
      else {
        const need = -cash;
        const fromSide = Math.min(side, need);
        side -= fromSide;
        const extra = need - fromSide;
        outOfPocket += extra;
        monthlyDeficits[m] = extra;
        flows[m + 1] -= extra;
      }
      totals.rent += effRent; totals.expenses += expenses; totals.interest += interest;
      totals.principal += principal; totals.rentTax += rentTax; totals.payments += payment;

      if ((m + 1) % 12 === 0) {
        const debt = tracks[0].bal + tracks[1].bal;
        const sale = saleProceeds(value, debt, cpiFactor);
        yearly.push({
          year: y + 1, value: value, debt: debt, equityInProperty: value - debt, rent: rent,
          cumRent: totals.rent, cumInterest: totals.interest, side: side, outOfPocket: outOfPocket,
          netWorth: sale.net + side, invested: p.equity + outOfPocket, cpiFactor: cpiFactor,
          realNetWorth: (sale.net + side) / cpiFactor
        });
      }
    }

    function saleProceeds(v, debt, cpi) {
      const sellCosts = v * (pct(p.sellBrokerPct) + pct(p.sellLawyerPct)) * vat;
      const indexedBasis = totalCost * cpi;
      const realGain = v - sellCosts - indexedBasis;
      const tax = p.capitalGainsExempt ? 0 : Math.max(0, realGain) * TAX.landAppreciation / 100;
      return { sellCosts: sellCosts, tax: tax, net: v - sellCosts - tax - debt, realGain: realGain };
    }

    const debtEnd = tracks[0].bal + tracks[1].bal;
    const sale = saleProceeds(value, debtEnd, cpiFactor);
    const netWorth = sale.net + side;
    flows[months] += netWorth;
    const invested = p.equity + outOfPocket;
    const firstPayment = (function () {
      const s = mortgageSchedule({ amount: loan * (1 - idxShare), rate: p.mortgageRate, years: p.mortgageYears, type: p.mortgageType }, infl);
      const s2 = mortgageSchedule({ amount: loan * idxShare, rate: p.mortgageRate, years: p.mortgageYears, type: p.mortgageType, indexed: true }, infl);
      return s.firstPayment + s2.firstPayment;
    })();
    const annualNoi = (p.rent * Math.max(0, 12 - p.vacancyMonths)) - (p.rent * 12 * pct(p.maintenancePct)) -
      (p.rent * Math.max(0, 12 - p.vacancyMonths) * pct(p.managementPct)) - p.insurance - p.landlordMonthly * 12;

    return {
      params: p,
      purchase: { purchaseTax: pTax, lawyer: lawyer, broker: broker, renovation: +p.renovation || 0,
        other: +p.otherBuyCosts || 0, buyCosts: buyCosts, totalCost: totalCost },
      loan: loan, ltv: ltv, maxLtv: maxLtv, ltvWarning: ltv > maxLtv + 0.01,
      firstPayment: firstPayment,
      grossYield: p.price > 0 ? p.rent * 12 / p.price * 100 : 0,
      netYield: p.price > 0 ? annualNoi / totalCost * 100 : 0,
      cashOnCash: p.equity > 0 ? firstYearCash / p.equity * 100 : 0,
      firstYearMonthlyCash: firstYearCash / 12,
      totals: totals, sale: sale, finalValue: value, debtEnd: debtEnd, side: side,
      outOfPocket: outOfPocket, invested: invested, netWorth: netWorth,
      profit: netWorth - invested, multiple: invested > 0 ? netWorth / invested : 0,
      irr: irr(flows), realNetWorth: netWorth / cpiFactor, cpiFactor: cpiFactor,
      yearly: yearly, monthlyDeficits: monthlyDeficits
    };
  }

  /* ---------- Stocks ---------- */

  const ST_DEFAULTS = {
    initial: 500000,
    monthly: 0,
    contributionGrowth: 0,      // % increase of monthly deposit per year
    priceReturn: 8,             // % annual price appreciation (ex-dividend)
    dividendYield: 1.5,
    reinvestDividends: true,
    expenseRatio: 0.1,          // דמי ניהול של הקרן/ETF
    managementFee: 0,           // דמי ניהול מצבירה (בית השקעות / גמל להשקעה)
    buyFeePct: 0.1,             // עמלת קנייה / דמי ניהול מהפקדה
    wrapper: 'regular',         // 'regular' | 'hishtalmut' | 'deferred'
    taxRealGain: false,         // מס על רווח ריאלי בלבד
    inflation: 2.5,
    years: 15
  };

  /**
   * Stock-market simulation. extraContribs: optional per-month array of additional deposits.
   * paths: { priceReturn: [...], inflation: [...] } per-year arrays (override constants).
   */
  function simulateStocks(input, extraContribs, paths) {
    const p = Object.assign({}, ST_DEFAULTS, input);
    paths = paths || {};
    const pr = paths.priceReturn || p.priceReturn;
    const infl = paths.inflation || p.inflation;
    const years = Math.max(1, Math.round(p.years));
    const months = years * 12;
    const buyFee = pct(p.buyFeePct);
    const taxDiv = p.wrapper === 'regular' ? TAX.dividends / 100 : 0;
    const taxCg = p.wrapper === 'hishtalmut' ? 0 : TAX.capitalGains / 100;

    let bal = p.initial * (1 - buyFee);
    let basis = p.initial;          // nominal cost basis
    let indexedBasis = p.initial;   // inflation-linked cost basis
    let cash = 0;                   // dividends not reinvested
    let contributed = p.initial;
    let cpiFactor = 1;
    let fees = p.initial * buyFee;
    let divTaxPaid = 0, divGross = 0;
    let deposit = p.monthly;
    const flows = new Array(months + 1).fill(0);
    flows[0] = -p.initial;
    const yearly = [];

    function liquidation(b, bs, ib) {
      const gainBase = p.taxRealGain ? ib : bs;
      const gain = b - gainBase;
      const tax = Math.max(0, gain) * taxCg;
      return { tax: tax, net: b - tax };
    }

    for (let m = 0; m < months; m++) {
      const y = Math.floor(m / 12);
      if (m > 0 && m % 12 === 0) deposit *= 1 + pct(p.contributionGrowth);
      const inflM = monthly(rateAt(infl, y));
      cpiFactor *= 1 + inflM;
      indexedBasis *= 1 + inflM;

      // growth (price) net of fund expense ratio
      const g = monthly(rateAt(pr, y));
      bal *= 1 + g;
      const er = bal * pct(p.expenseRatio) / 12;
      const mf = bal * pct(p.managementFee) / 12;
      bal -= er + mf; fees += er + mf;

      // dividends
      const div = bal * pct(p.dividendYield) / 12;
      const t = div * taxDiv;
      divGross += div; divTaxPaid += t;
      const netDiv = div - t;
      if (p.reinvestDividends) {
        bal += netDiv;
        if (p.wrapper === 'regular') { basis += netDiv; indexedBasis += netDiv; }
      } else {
        cash += netDiv;
      }

      // deposits
      const dep = deposit + (extraContribs ? (extraContribs[m] || 0) : 0);
      if (dep > 0) {
        bal += dep * (1 - buyFee); fees += dep * buyFee;
        basis += dep; indexedBasis += dep; contributed += dep;
        flows[m + 1] -= dep;
      }

      if ((m + 1) % 12 === 0) {
        const liq = liquidation(bal, basis, indexedBasis);
        yearly.push({ year: y + 1, balance: bal, contributed: contributed, cash: cash,
          netWorth: liq.net + cash, realNetWorth: (liq.net + cash) / cpiFactor, cpiFactor: cpiFactor,
          dividends: divGross });
      }
    }
    const liq = liquidation(bal, basis, indexedBasis);
    const netWorth = liq.net + cash;
    flows[months] += netWorth;
    return {
      params: p, balance: bal, cash: cash, contributed: contributed, capitalGainsTax: liq.tax,
      dividendTax: divTaxPaid, dividendsGross: divGross, fees: fees,
      netWorth: netWorth, profit: netWorth - contributed,
      multiple: contributed > 0 ? netWorth / contributed : 0, irr: irr(flows),
      realNetWorth: netWorth / cpiFactor, cpiFactor: cpiFactor, yearly: yearly
    };
  }

  /* ---------- Comparison ---------- */

  /**
   * Compare equal starting capital. RE monthly deficits (money the landlord adds) are
   * also invested in the stock portfolio when `fair` is true, so both sides get the same money.
   */
  function compare(reInput, stInput, opts, paths) {
    opts = opts || {};
    paths = paths || {};
    const amount = opts.amount;
    const years = opts.years;
    const reIn = Object.assign({}, reInput, { equity: amount, years: years });
    if (opts.autoPrice) {
      const ratio = reInput.price > 0 ? reInput.rent / reInput.price : 0;
      reIn.price = maxPriceForEquity(reInput, amount, opts.ltv);
      reIn.rent = Math.round(reIn.price * ratio);
    }
    const re = simulateRealEstate(reIn,
      { appreciation: paths.appreciation, inflation: paths.inflation, rentGrowth: paths.rentGrowth });
    const st = simulateStocks(Object.assign({}, stInput, { initial: amount, monthly: 0, years: years }),
      opts.fair === false ? null : re.monthlyDeficits,
      { priceReturn: paths.priceReturn, inflation: paths.inflation });
    const diff = re.netWorth - st.netWorth;
    return { re: re, st: st, diff: diff, winner: diff >= 0 ? 're' : 'st' };
  }

  /** Find appreciation % at which RE equals stocks (bisection). */
  function breakEvenAppreciation(reInput, stInput, opts) {
    let lo = -10, hi = 30;
    const f = function (a) { return compare(Object.assign({}, reInput, { appreciation: a }), stInput, opts).diff; };
    let flo = f(lo), fhi = f(hi);
    if (flo * fhi > 0) return NaN;
    for (let i = 0; i < 50; i++) {
      const mid = (lo + hi) / 2, fm = f(mid);
      if (flo * fm <= 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
    }
    return (lo + hi) / 2;
  }

  /* ---------- Historical statistics ---------- */

  function stats(values) {
    const n = values.length;
    if (!n) return null;
    let g = 1, sum = 0;
    values.forEach(function (v) { g *= 1 + v / 100; sum += v; });
    const mean = sum / n;
    const sd = Math.sqrt(values.reduce(function (a, v) { return a + (v - mean) * (v - mean); }, 0) / Math.max(1, n - 1));
    return { n: n, cagr: (Math.pow(g, 1 / n) - 1) * 100, mean: mean, sd: sd,
      min: Math.min.apply(null, values), max: Math.max.apply(null, values),
      negYears: values.filter(function (v) { return v < 0; }).length, growth: g };
  }

  /** Rolling N-year CAGR windows over a series {start, data}. */
  function rollingWindows(h, years) {
    const out = [];
    for (let i = 0; i + years <= h.data.length; i++) {
      let g = 1;
      for (let j = i; j < i + years; j++) g *= 1 + h.data[j] / 100;
      out.push({ start: h.start + i, end: h.start + i + years - 1, cagr: (Math.pow(g, 1 / years) - 1) * 100, growth: g });
    }
    return out;
  }

  function percentile(sorted, q) {
    if (!sorted.length) return NaN;
    const idx = (sorted.length - 1) * q;
    const lo = Math.floor(idx), hi = Math.ceil(idx);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  }

  /** Simple seeded PRNG (mulberry32) so results are stable between renders. */
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function stockSeries(key) {
    return D.HISTORY[key] || D.HISTORY.sp500;
  }

  /** Converts a total-return/price series to a price-return path given the user's dividend yield. */
  function toPriceReturns(key, values, divYield) {
    // ta125 is a price index already; S&P series are total return
    if (key === 'ta125') return values.slice();
    return values.map(function (v) { return ((1 + v / 100) / (1 + divYield / 100) - 1) * 100; });
  }

  /**
   * Monte-Carlo for the stock calculator: bootstrap of historical years.
   */
  function monteCarloStocks(stInput, key, sims, seed) {
    const h = stockSeries(key);
    const rand = rng(seed || 42);
    const years = Math.max(1, Math.round(stInput.years));
    const results = [];
    const bands = [];
    for (let s = 0; s < sims; s++) {
      const path = [];
      for (let y = 0; y < years; y++) path.push(h.data[Math.floor(rand() * h.data.length)]);
      const r = simulateStocks(stInput, null, { priceReturn: toPriceReturns(key, path, stInput.dividendYield || 0) });
      results.push(r.netWorth);
      bands.push(r.yearly.map(function (yr) { return yr.netWorth; }));
    }
    const sorted = results.slice().sort(function (a, b) { return a - b; });
    const yearBands = [];
    for (let y = 0; y < years; y++) {
      const col = bands.map(function (b) { return b[y]; }).sort(function (a, b) { return a - b; });
      yearBands.push({ year: y + 1, p10: percentile(col, 0.1), p50: percentile(col, 0.5), p90: percentile(col, 0.9) });
    }
    const contributed = simulateStocks(stInput).contributed;
    return {
      p10: percentile(sorted, 0.1), p25: percentile(sorted, 0.25), p50: percentile(sorted, 0.5),
      p75: percentile(sorted, 0.75), p90: percentile(sorted, 0.9),
      lossProb: results.filter(function (v) { return v < contributed; }).length / sims * 100,
      yearBands: yearBands, contributed: contributed
    };
  }

  /** Aligned Israeli years with a given stock series (for joint sampling / backtests). */
  function alignedYears(key) {
    const h = stockSeries(key);
    const H = D.HISTORY;
    const out = [];
    for (let y = H.housing.start; y < H.housing.start + H.housing.data.length; y++) {
      const si = y - h.start;
      if (si < 0 || si >= h.data.length) continue;
      out.push({ year: y, stock: h.data[si], housing: H.housing.data[y - H.housing.start], cpi: H.cpi.data[y - H.cpi.start] });
    }
    return out;
  }

  /** Monte-Carlo comparison: joint bootstrap of (housing, stocks, CPI) years so correlations are kept. */
  function monteCarloCompare(reInput, stInput, opts, key, sims, seed) {
    const rows = alignedYears(key);
    const rand = rng(seed || 7);
    const years = Math.max(1, Math.round(opts.years));
    let reWins = 0;
    const reVals = [], stVals = [], diffs = [];
    for (let s = 0; s < sims; s++) {
      const appr = [], stk = [], inf = [];
      for (let y = 0; y < years; y++) {
        const r = rows[Math.floor(rand() * rows.length)];
        appr.push(r.housing); stk.push(r.stock); inf.push(r.cpi);
      }
      const c = compare(reInput, stInput, opts, {
        appreciation: appr, inflation: inf,
        priceReturn: toPriceReturns(key, stk, stInput.dividendYield || 0)
      });
      if (c.diff >= 0) reWins++;
      reVals.push(c.re.netWorth); stVals.push(c.st.netWorth); diffs.push(c.diff);
    }
    const srt = function (a) { return a.slice().sort(function (x, y) { return x - y; }); };
    const R = srt(reVals), S = srt(stVals), Df = srt(diffs);
    return {
      reWinPct: reWins / sims * 100,
      re: { p10: percentile(R, 0.1), p50: percentile(R, 0.5), p90: percentile(R, 0.9) },
      st: { p10: percentile(S, 0.1), p50: percentile(S, 0.5), p90: percentile(S, 0.9) },
      diff: { p10: percentile(Df, 0.1), p50: percentile(Df, 0.5), p90: percentile(Df, 0.9) },
      sampleYears: rows.length ? rows[0].year + '–' + rows[rows.length - 1].year : ''
    };
  }

  /** Historical backtest: for every start year with enough data, run the actual sequence. */
  function backtestCompare(reInput, stInput, opts, key) {
    const rows = alignedYears(key);
    const years = Math.max(1, Math.round(opts.years));
    const out = [];
    for (let i = 0; i + years <= rows.length; i++) {
      const w = rows.slice(i, i + years);
      const c = compare(reInput, stInput, opts, {
        appreciation: w.map(function (r) { return r.housing; }),
        inflation: w.map(function (r) { return r.cpi; }),
        priceReturn: toPriceReturns(key, w.map(function (r) { return r.stock; }), stInput.dividendYield || 0)
      });
      out.push({ start: w[0].year, end: w[w.length - 1].year, re: c.re.netWorth, st: c.st.netWorth, diff: c.diff,
        reIrr: c.re.irr, stIrr: c.st.irr });
    }
    return out;
  }

  /* ---------- Small tools ---------- */

  /** Monthly saving needed to reach target. */
  function savingsNeeded(target, years, annualRet, current) {
    const r = monthly(annualRet), n = years * 12;
    const fvCurrent = (current || 0) * Math.pow(1 + r, n);
    const rem = target - fvCurrent;
    if (rem <= 0) return 0;
    if (Math.abs(r) < 1e-12) return rem / n;
    return rem * r / (Math.pow(1 + r, n) - 1);
  }

  /** Cost of fees: final value with and without a fee. */
  function feeImpact(amount, monthlyDep, years, ret, fee) {
    const run = function (f) {
      let b = amount; const g = monthly(ret);
      for (let m = 0; m < years * 12; m++) { b *= 1 + g; b -= b * pct(f) / 12; b += monthlyDep; }
      return b;
    };
    const noFee = run(0), withFee = run(fee);
    return { noFee: noFee, withFee: withFee, lost: noFee - withFee, lostPct: noFee > 0 ? (noFee - withFee) / noFee * 100 : 0 };
  }

  /** Financial independence: capital needed for a monthly net income using a withdrawal rate. */
  function fireTarget(monthlyIncome, withdrawalRate) {
    return monthlyIncome * 12 / pct(withdrawalRate);
  }

  /** Years to reach a target with given savings. */
  function yearsToTarget(target, current, monthlyDep, annualRet) {
    const r = monthly(annualRet);
    let b = current, m = 0;
    while (b < target && m < 1200) { b = b * (1 + r) + monthlyDep; m++; }
    return m >= 1200 ? Infinity : m / 12;
  }

  /** Maximum property price affordable from equity, LTV and payment limits. */
  function affordability(equity, monthlyNetIncome, rate, years, ltvMax, paymentRatioMax) {
    const maxPayment = monthlyNetIncome * pct(paymentRatioMax);
    const r = monthly(rate), n = years * 12;
    const loanByIncome = Math.abs(r) < 1e-12 ? maxPayment * n : maxPayment * (1 - Math.pow(1 + r, -n)) / r;
    const loanByLtv = equity * pct(ltvMax) / (1 - pct(ltvMax));
    const loan = Math.min(loanByIncome, loanByLtv);
    return { maxPayment: maxPayment, loanByIncome: loanByIncome, loanByLtv: loanByLtv, loan: loan,
      price: equity + loan, limitedBy: loanByIncome < loanByLtv ? 'income' : 'ltv' };
  }

  const api = {
    pmt: pmt, bracketTax: bracketTax, purchaseTax: purchaseTax, irr: irr, mortgageSchedule: mortgageSchedule,
    simulateRealEstate: simulateRealEstate, simulateStocks: simulateStocks, compare: compare,
    breakEvenAppreciation: breakEvenAppreciation, stats: stats, rollingWindows: rollingWindows,
    monteCarloStocks: monteCarloStocks, monteCarloCompare: monteCarloCompare, backtestCompare: backtestCompare,
    alignedYears: alignedYears, savingsNeeded: savingsNeeded, maxPriceForEquity: maxPriceForEquity, buyCostsFor: buyCostsFor, feeImpact: feeImpact, fireTarget: fireTarget,
    yearsToTarget: yearsToTarget, affordability: affordability, percentile: percentile,
    RE_DEFAULTS: RE_DEFAULTS, ST_DEFAULTS: ST_DEFAULTS, monthly: monthly
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.InvestCalc = api;
})(typeof window !== 'undefined' ? window : globalThis);
